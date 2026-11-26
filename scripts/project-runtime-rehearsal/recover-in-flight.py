"""Prove a real broker process exit during one isolated owner Run."""

import argparse
from datetime import UTC, datetime
from hashlib import sha256
from http.server import ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
from tempfile import TemporaryDirectory
from threading import Event, Thread
import time
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

HERE = Path(__file__).resolve().parent
PLATFORM_REVISION = "552f5e5c03cbc33b428855c1055c09c549d5fdf2"
CASES = {
    "recovery": "cases-b17cb044-3324-4788-8202-9e2dfc18947a",
    "rejected_inputs": "cases-bc81236b-2c49-4aff-9a1f-d211ee142c79",
}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--broker-checkout", type=Path, required=True)
parser.add_argument("--broker-head", required=True)
parser.add_argument("--platform-checkout", type=Path, required=True)
if os.environ.get("OOS_DELIVERY_ART_EVIDENCE_MODE") == "verification-only":
    parser.error("Run the disposable rehearsal before requesting the recorded result in the Console.")
if not __debug__:
    parser.error("Run the rehearsal with its outcome assertions enabled.")
args = parser.parse_args()


def require_revision(repository, revision):
    git = ['git', '-C', str(repository)]
    assert subprocess.check_output([*git, 'rev-parse', 'HEAD'], text=True).strip() == revision
    assert not subprocess.check_output([*git, 'status', '--porcelain'], text=True).strip()


platform_checkout = args.platform_checkout.resolve()
require_revision(platform_checkout, PLATFORM_REVISION)
sys.path[:0] = [str(platform_checkout / folder) for folder in (
    'products/governance-operations-console/scripts', 'scripts',
)]
from platform_operation_provider import OperationStore
import platform_operation_provider as platform
from agent_source_identity import write_json_atomic
from agent_source_instance import digest
from console_project_runtime_driver import K3sProjectClient, ProjectSandboxDriver
from console_project_runtime_operations import ProjectRuntimeOperations
from console_project_runtime_provider import ProjectRuntimeProvider
from console_project_runtime_sandbox import SandboxRecipe, WorkloadLimits
from console_project_runtime_setup import CommittedSource, ProjectSetupStore, scope_key
from console_project_runtime_snapshot import stage_project_snapshot

IMAGE = 'docker.io/library/node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94'
RECIPE = SandboxRecipe(IMAGE, IMAGE, WorkloadLimits(250, 192, 256, 120), WorkloadLimits(100, 96, 64, 120),
                       WorkloadLimits(350, 288, 320, 120), 2048, 128)


def main(broker, broker_head):
    if not re.fullmatch(r"[0-9a-f]{40}", broker_head):
        raise ValueError("Supply the exact reviewed Broker revision.")
    require_revision(broker, broker_head)
    with TemporaryDirectory(prefix='1384-inflight-') as temporary:
        root = Path(temporary)
        repo, snapshots, cache = (root / name for name in ('repo', 'snapshots', 'cache'))
        for directory in (repo, repo / 'app', repo / 'shared', repo / 'unapproved', snapshots, cache, root / 'staging'):
            directory.mkdir(mode=0o700)
        subprocess.run(['git','-C',str(repo),'init','-q'],check=True)
        (repo / 'app/index.html').write_text('<main>Old</main>\n')
        (repo / 'app/remove.txt').write_text('Remove this file\n')
        (repo / 'shared/logo.bin').write_bytes(b'\x00\x80\xff\x01')
        (repo / 'shared/module.js').write_text('export default "admitted workspace file";\n')
        (repo / 'private.txt').write_text('outside the selection\n')
        (repo / 'unapproved/module.js').write_text('export default "outside approved dependencies";\n')
        subprocess.run(['git','-C',str(repo),'add','.'],check=True)
        subprocess.run(['git','-C',str(repo),'-c','user.name=Disposable Test','-c','user.email=proof@example.invalid',
                        'commit','-qm','Pinned isolated input'],check=True)
        base = subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()
        scope = {'installation_id': f'rehearsal:{uuid4().hex}', 'project_custody_ref':'project:in-flight-rehearsal',
                 'repository_id':42, 'app_root':'app', 'dependency_paths':['shared'], 'environment_ref':'devint:1384-rehearsal'}
        scope_digest = 'sha256:' + scope_key(scope)
        namespace = 'devint-project-' + scope_digest[7:39]
        kube = K3sProjectClient()
        assert kube.get('namespace',namespace) is None
        store = OperationStore(root / 'owner')
        setup = ProjectSetupStore(store).save(scope, requested_app_root='app',recipe_id='static',
                    expected_revision=None,source=CommittedSource(repo,base))['setup']
        release_build = Event()
        started = Event()
        finished = Event()
        verified = {}
        submissions = []

        def admit(supplied):
            assert supplied == scope
            return {'project_ref':scope['project_custody_ref'],'subject':{'kind':'delivery','ref':'work-item-42'}}

        def authorize(record):
            assert record['binding']['scope'] == scope
            return {'recipe':RECIPE, 'source_limits':{'max_manifest_bytes':16384,'max_files':24,'max_bytes':65536},
                    'input_mib':128,'cache_mib':128,'cache_bytes':65536,'cache_expanded_bytes':65536,'data_mib':0}

        class Driver(ProjectSandboxDriver):
            def start(self, record):
                submissions.append(record['operation_id'])
                try:
                    started.set()
                    if not release_build.wait(timeout=40):
                        raise TimeoutError('Broker recovery was not observed')
                    copy = stage_project_snapshot(snapshots, root / 'staging', record['binding'],
                                                  max_manifest_bytes=16384,max_files=24,max_bytes=65536)
                    expected = {'app/index.html':b'<main>Verified in-flight recovery</main>\n',
                                'shared/logo.bin':b'\x00\x80\xff\x01',
                                'shared/module.js':b'export default "admitted workspace file";\n'}
                    assert set(name.relative_to(copy).as_posix() for name in copy.rglob('*') if name.is_file()) == set(expected)
                    for name, content in expected.items():
                        assert (copy / name).read_bytes() == content
                        verified[name] = 'sha256:' + sha256(content).hexdigest()
                    return super().start(record)
                finally:
                    finished.set()

        driver = Driver(root / 'native', kube=kube, snapshot_root=snapshots,cache_root=cache,authorize=authorize,
                        dependency_approval=lambda *unused: None)
        owner = ProjectRuntimeOperations(store,driver=driver)
        provider = ProjectRuntimeProvider(owner,admit=admit)
        fixture = SimpleNamespace(policy={'runtime_state_root':str(root)},source_version='disposable',project_runtime=provider)
        secret = secrets.token_hex(24)
        supervisor = None
        with patch.object(platform,'activation_is_current',return_value=True), \
                patch.object(platform.artifact_recovery,'blocked',return_value=None), \
                ThreadingHTTPServer(('127.0.0.1',0),platform.handler_for(fixture,'rehearsal-broker',secret)) as server:
            thread = Thread(target=server.serve_forever,daemon=True)
            thread.start()
            try:
                value = json.dumps({'root':str(root),'broker':str(broker),'repository':str(repo),'snapshots':str(snapshots),
                    'base':base,'scope':scope,'setup':setup,'url':f'http://127.0.0.1:{server.server_port}','secret':secret})
                script = str(HERE / 'recover-in-flight.mjs')
                interrupted = subprocess.run(['node',script,'dispatch'],input=value,text=True,capture_output=True,timeout=35)
                assert interrupted.returncode == -signal.SIGKILL, interrupted.stderr
                assert started.wait(timeout=8)
                accepted = json.loads((root / 'owner-receipt.json').read_text())
                original = json.loads((root / 'broker-receipt.json').read_text())
                assert accepted['operation_id'] == original['operation_id']
                assert accepted['configuration_revision'] == setup['configuration_revision']
                assert accepted['manifest_digest'] == original['snapshot']['manifest_digest']
                assert kube.get('namespace',namespace) is None
                supervisor = subprocess.Popen(['node',script,'recover'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                                              stderr=subprocess.PIPE,text=True)
                supervisor.stdin.write(value)
                supervisor.stdin.close()
                supervisor.stdin = None
                checkpoint = root / 'recovery-observed.json'
                until = time.monotonic() + 18
                while not checkpoint.exists() and supervisor.poll() is None and time.monotonic() < until:
                    time.sleep(0.1)
                assert checkpoint.exists(), supervisor.stderr.read() if supervisor.poll() is not None else 'Recovery read timeout'
                observed = json.loads(checkpoint.read_text())
                assert observed['acknowledgement'] == original
                assert observed['status'] == 'preparing'
                release_build.set()
                result, errors = supervisor.communicate(timeout=165)
                assert supervisor.returncode == 0, errors
                proof = json.loads(result)
                assert submissions == [accepted['operation_id']]
                assert len(verified) == 3
                match = re.fullmatch(r'project-runtime:(devint-project-[0-9a-f]{32})/(frontend-[0-9a-f]{32})',proof['instanceRef'])
                assert match is not None and match[1] == namespace
                served = subprocess.check_output(['k3s','kubectl','-n',namespace,'exec',match[2],'--','node','-e',
                    "fetch('http://127.0.0.1:3000').then(r=>r.text()).then(s=>process.stdout.write(s))"],timeout=15)
                assert served == b'<main>Verified in-flight recovery</main>\n'
                before_negative = owner.inspect(scope)
                rejected = subprocess.run(['node',script,'reject'],input=value,text=True,capture_output=True,timeout=30)
                assert rejected.returncode == 0, rejected.stderr
                assert owner.inspect(scope) == before_negative
                assert submissions == [accepted['operation_id']]
                proof.update({'observedAfterRestart':'preparing','effectCount':len(submissions),'configurationRevision':setup['configuration_revision'],
                              'manifestFiles':verified,'removedAndOutOfScopeFilesAbsent':True,'originalProcessExit':'SIGKILL',
                              'servedExactDraft':True,'rejections':json.loads(rejected.stdout),'priorOwnerStatePreserved':True})
            finally:
                if supervisor is not None and supervisor.poll() is None:
                    supervisor.terminate()
                    supervisor.wait(timeout=10)
                release_build.set()
                if started.is_set():
                    finished.wait(timeout=125)
                server.shutdown()
                thread.join(timeout=4)
                metadata = kube.get('namespace',namespace)
                if metadata is not None:
                    assert metadata['metadata']['annotations']['platform.project/scope'] == scope_digest
                    subprocess.run(['k3s','kubectl','delete','namespace',namespace,'--timeout=100s'],check=True,capture_output=True)
        assert kube.get('namespace',namespace) is None
        proof['disposableNamespaceRemoved'] = True
        proof['sourceRevisions'] = {'broker': broker_head, 'platform': PLATFORM_REVISION}
        return proof


if __name__ == '__main__':
    receipt_root = Path.home() / ".local/state/operator-orchestration-service/project-runtime/rehearsal-receipts"
    receipt_root.mkdir(parents=True, mode=0o700, exist_ok=True)
    private = receipt_root.lstat()
    if receipt_root.is_symlink() or not receipt_root.is_dir() or private.st_uid != os.geteuid() or private.st_mode & 0o077:
        raise ValueError("The executor rehearsal receipt directory must be private.")
    observations = main(args.broker_checkout.resolve(), args.broker_head)
    payload = {
        "artifact_type": "broker-project-runtime-rehearsal/v1",
        "recorded_at": datetime.now(UTC).isoformat(),
        "state": "completed",
        "plan_cases": CASES,
        "observations": observations,
    }
    target = receipt_root / f"{args.broker_head}.json"
    write_json_atomic(target, {**payload, "content_digest": digest(payload)})
    print(target)

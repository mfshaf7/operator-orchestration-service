.PHONY: validate
validate:
	python3 scripts/validate_owner.py --repo-root .
	python3 -m unittest discover -s tests -p test_owner_bootstrap.py

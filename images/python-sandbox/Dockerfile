# Runs untrusted Python tests: public tests for laptop runners (`run`) and HQ checks (`check`).
# Isolation (no network, read-only mounts, resource caps) comes from how it is started; see
# "Test sandbox" in docs/technical.md.
FROM python:3.13-slim@sha256:70729b46c69b4f1e97c4822c1af3df53a1476cf5ddc6c087c0c10bc3a5678c2f

RUN useradd --uid 10001 --no-create-home --home-dir /tmp sandbox

COPY requirements.txt /opt/sideagent/requirements.txt
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r /opt/sideagent/requirements.txt

COPY pytest.ini run_checks.py /opt/sideagent/
USER 10001
WORKDIR /tmp

ENTRYPOINT ["python", "-I", "/opt/sideagent/run_checks.py"]
CMD ["check"]

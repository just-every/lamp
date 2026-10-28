#!/usr/bin/env python3
"""Bound Playwright's apt fallback; never download or select another browser."""
import os
import signal
from pathlib import Path
import subprocess
import tempfile

archives = Path(os.environ['APT_ARCHIVES'])
archives.mkdir(parents=True, exist_ok=True)
(archives / 'partial').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='lamp-apt-') as directory:
    config = Path(directory) / 'apt.conf'
    config.write_text(
        'Acquire::Retries "1";\n'
        'Acquire::http::Timeout "20";\n'
        'Acquire::https::Timeout "20";\n'
        f'Dir::Cache::archives "{archives}";\n'
    )
    child = subprocess.Popen(
        ['pnpm', 'exec', 'playwright', 'install-deps', 'chromium'],
        env={**os.environ, 'APT_CONFIG': str(config), 'DEBIAN_FRONTEND': 'noninteractive'},
        start_new_session=True,
    )
    try:
        result = child.wait(timeout=240)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
        raise SystemExit('Chromium dependency fallback exceeded 240 seconds')
    if result:
        raise SystemExit(result)

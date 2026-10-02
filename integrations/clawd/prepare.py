#!/usr/bin/env python3
"""Build the pinned Clawd observer; no customer-side download or installer."""
import argparse
import hashlib
import io
import json
import pathlib
import shutil
import subprocess
import tempfile
import tarfile
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent
LOCK = json.loads((ROOT / 'upstream.lock.json').read_text())


def download(url, checksum):
    cache = ROOT / '.cache' / checksum
    if not cache.exists():
        data = urllib.request.urlopen(url, timeout=120).read()
        if hashlib.sha256(data).hexdigest() != checksum:
            raise ValueError('download checksum mismatch')
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(data)
    data = cache.read_bytes()
    if hashlib.sha256(data).hexdigest() != checksum:
        raise ValueError('cache checksum mismatch')
    return data


def prepare_source():
    clawd = LOCK['clawd']
    data = download('https://codeload.github.com/rullerzhou-afk/clawd-on-desk/tar.gz/' + clawd['commit'], clawd['archiveSha256'])
    source = ROOT / 'upstream'
    if source.exists():
        shutil.rmtree(source)
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for member in archive:
            parts = pathlib.PurePosixPath(member.name).parts[1:]
            if not parts or '..' in parts or parts[0] not in ('src', 'agents', 'hooks', 'LICENSE', 'NOTICE.md', 'package.json'):
                continue
            if member.isfile():
                target = source.joinpath(*parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.extractfile(member).read())
    for patch in sorted((ROOT / 'patches').glob('*.patch')):
        subprocess.run(['git', 'apply', '--no-index', '--unsafe-paths',
                        '--directory=' + str(source), str(patch)], check=True)
    return source


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', choices=[*LOCK['node']['artifacts'], 'darwin-universal'])
    parser.add_argument('--output', type=pathlib.Path)
    args = parser.parse_args()
    if bool(args.platform) != bool(args.output):
        parser.error('--platform and --output must be supplied together')
    source = prepare_source()
    if not args.output:
        return
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    # Build into a caller-owned staging directory; the normal app updater owns
    # installation and atomic replacement of the containing application.
    for name in ('src', 'test', 'upstream', 'patches'):
        if (output / name).exists():
            shutil.rmtree(output / name)
        shutil.copytree(ROOT / name, output / name)
    # Full corresponding upstream source, including files not used at runtime.
    shutil.copyfile(ROOT / '.cache' / LOCK['clawd']['archiveSha256'], output / 'clawd-source.tar.gz')
    for name in ('upstream.lock.json', 'NOTICE.md', 'prepare.py', 'node.entitlements'):
        shutil.copyfile(ROOT / name, output / name)
    platforms = ['darwin-arm64', 'darwin-x64'] if args.platform == 'darwin-universal' else [args.platform]
    binaries = []
    for platform in platforms:
        artifact = LOCK['node']['artifacts'][platform]
        data = download('https://nodejs.org/dist/v' + LOCK['node']['version'] + '/' + artifact['file'], artifact['sha256'])
        folder = artifact['file'].removesuffix('.tar.gz').removesuffix('.zip')
        if platform.startswith('win'):
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                binary = archive.read(folder + '/node.exe')
                license_text = archive.read(folder + '/LICENSE')
            name = 'node.exe'
        else:
            with tarfile.open(fileobj=io.BytesIO(data)) as archive:
                binary = archive.extractfile(folder + '/bin/node').read()
                license_text = archive.extractfile(folder + '/LICENSE').read()
            name = 'node'
        binaries.append(binary)
    if len(binaries) == 2:
        with tempfile.TemporaryDirectory(prefix='vibetv-node-') as work:
            paths = [pathlib.Path(work) / arch for arch in ('arm64', 'x64')]
            for target, data in zip(paths, binaries):
                target.write_bytes(data)
            universal = pathlib.Path(work) / 'node'
            subprocess.run(['lipo', '-create', *map(str, paths), '-output', str(universal)], check=True)
            binary = universal.read_bytes()
    (output / name).write_bytes(binary)
    (output / name).chmod(0o755)
    (output / 'NODE-LICENSE').write_bytes(license_text)


if __name__ == '__main__':
    main()

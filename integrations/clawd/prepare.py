#!/usr/bin/env python3
"""Build the pinned Clawd observer; no customer-side download or installer."""
import argparse
import hashlib
import io
import json
import pathlib
import shutil
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
    return source


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--platform', choices=LOCK['node']['artifacts'])
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
    for name in ('src', 'upstream'):
        shutil.copytree(ROOT / name, output / name, dirs_exist_ok=True)
    for name in ('upstream.lock.json', 'NOTICE.md', 'prepare.py'):
        shutil.copyfile(ROOT / name, output / name)
    artifact = LOCK['node']['artifacts'][args.platform]
    data = download('https://nodejs.org/dist/v' + LOCK['node']['version'] + '/' + artifact['file'], artifact['sha256'])
    folder = artifact['file'].removesuffix('.tar.gz').removesuffix('.zip')
    if args.platform.startswith('win'):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            binary = archive.read(folder + '/node.exe')
            license_text = archive.read(folder + '/LICENSE')
        name = 'node.exe'
    else:
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            binary = archive.extractfile(folder + '/bin/node').read()
            license_text = archive.extractfile(folder + '/LICENSE').read()
        name = 'node'
    (output / name).write_bytes(binary)
    (output / name).chmod(0o755)
    (output / 'NODE-LICENSE').write_bytes(license_text)


if __name__ == '__main__':
    main()

"""Minimal Brotli API adapter for the fontTools WOFF2 test oracle.

The production implementation is TypeScript. This test-only Python module
delegates compression to the same Node.js runtime that launches Vitest, so the
fontTools oracle does not require a separately installed Python Brotli wheel.
"""

import os
import subprocess

MODE_GENERIC = 0
MODE_TEXT = 1
MODE_FONT = 2


class error(Exception):
    pass


_NODE_SCRIPT = r"""
const fs = require('node:fs')
const zlib = require('node:zlib')
const input = fs.readFileSync(0)
const operation = process.env.TSREPORT_BROTLI_OPERATION
if (operation === 'decompress') {
  process.stdout.write(zlib.brotliDecompressSync(input))
} else {
  const params = {}
  params[zlib.constants.BROTLI_PARAM_MODE] = Number(process.env.TSREPORT_BROTLI_MODE)
  params[zlib.constants.BROTLI_PARAM_QUALITY] = Number(process.env.TSREPORT_BROTLI_QUALITY)
  params[zlib.constants.BROTLI_PARAM_LGWIN] = Number(process.env.TSREPORT_BROTLI_LGWIN)
  const lgblock = Number(process.env.TSREPORT_BROTLI_LGBLOCK)
  if (lgblock !== 0) params[zlib.constants.BROTLI_PARAM_LGBLOCK] = lgblock
  process.stdout.write(zlib.brotliCompressSync(input, { params }))
}
"""


def _run(operation, data, mode=MODE_GENERIC, quality=11, lgwin=22, lgblock=0):
    environment = os.environ.copy()
    environment.update({
        "TSREPORT_BROTLI_OPERATION": operation,
        "TSREPORT_BROTLI_MODE": str(mode),
        "TSREPORT_BROTLI_QUALITY": str(quality),
        "TSREPORT_BROTLI_LGWIN": str(lgwin),
        "TSREPORT_BROTLI_LGBLOCK": str(lgblock),
    })
    try:
        result = subprocess.run(
            [environment.get("TSREPORT_NODE", "node"), "-e", _NODE_SCRIPT],
            input=bytes(data),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
            env=environment,
        )
    except subprocess.CalledProcessError as exception:
        raise error(exception.stderr.decode("utf-8", errors="replace")) from exception
    return result.stdout


def compress(string, mode=MODE_GENERIC, quality=11, lgwin=22, lgblock=0):
    return _run("compress", string, mode, quality, lgwin, lgblock)


def decompress(string):
    return _run("decompress", string)

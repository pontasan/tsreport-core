# Conformance fixture sources

These files are test data only. They are not shipped runtime dependencies.

## Graphite2 1.3.15

`graphite2-1.3.15/` contains the fonts, standards, and text inputs used by
`graphite-harfbuzz-oracle.test.ts`. They come from the official SIL Graphite2
repository tag `1.3.15`, commit
`ca8d821e60a15b6c24e404c9086992c975d8e1cf`:

<https://github.com/silnrsi/graphite/tree/1.3.15>

The upstream `LICENSE` and `COPYING` files are included with the fixtures.

## W3C WOFF2 compiled tests

`woff2-w3c/` is the complete compiled W3C WOFF2 format, decoder, and authoring
corpus from commit `1fd8cd583645618f4df36c65a297479840ad5510`:

<https://github.com/w3c/woff2-compiled-tests>

The corpus is retained verbatim except for its Git metadata.

Copyright © 2019 World Wide Web Consortium, (MIT, ERCIM, Keio, Beihang)
and others. The corpus is redistributed under the W3C Test Suite License
(2008); the required notice is included in
`woff2-w3c/LICENSE-W3C-TEST-SUITE.txt`.

## Google WOFF2 reference implementation

`google-woff2/` contains the reference encoder and decoder sources from commit
`fb9c3379f2605b10f3e8f1d9636664ab5576775c`:

<https://github.com/google/woff2>

The reference executables are built only in a temporary test directory. They
are independent test oracles and are not linked into the product. The upstream
`LICENSE` file is included.

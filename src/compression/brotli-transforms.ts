/*! Copyright 2009-2016 the Brotli Authors; Copyright 2026 Countertype LLC.
 * Distributed under the MIT license. See THIRD_PARTY_NOTICES.md. */

const PREFIX_SUFFIX_SOURCE = '# #s #, #e #.# the #.com/#\xC2\xA0# of # and # in # to #"#">#\n#]# for # a # that #. # with #\'# from # by #. The # on # as # is #ing #\n\t#:#ed #(# at #ly #="# of the #. This #,# not #er #al #=\'#ful #ive #less #est #ize #ous #'
const TRANSFORM_SOURCE = '     !! ! ,  *!  &!  " !  ) *   * -  ! # !  #!*!  +  ,$ !  -  %  .  / #   0  1 .  "   2  3!*   4%  ! # /   5  6  7  8 0  1 &   $   9 +   :  ;  < \'  !=  >  ?! 4  @ 4  2  &   A *# (   B  C& ) %  ) !*# *-% A +! *.  D! %\'  & E *6  F  G% ! *A *%  H! D  I!+!  J!+   K +- *4! A  L!*4  M  N +6  O!*% +.! K *G  P +%(  ! G *D +D  Q +# *K!*G!+D!+# +G +A +4!+% +K!+4!*D!+K!*K'

export function unpackBrotliTransforms(
  prefixSuffix: Int8Array | Uint8Array,
  prefixSuffixHeads: Int32Array | Uint16Array,
  transforms: Int32Array | Uint8Array,
): void {
  let headIndex = 1
  let byteIndex = 0
  for (let i = 0; i < PREFIX_SUFFIX_SOURCE.length; i++) {
    const value = PREFIX_SUFFIX_SOURCE.charCodeAt(i)
    if (value === 35) prefixSuffixHeads[headIndex++] = byteIndex
    else prefixSuffix[byteIndex++] = value
  }
  for (let i = 0; i < TRANSFORM_SOURCE.length; i++) {
    transforms[i] = TRANSFORM_SOURCE.charCodeAt(i) - 32
  }
}

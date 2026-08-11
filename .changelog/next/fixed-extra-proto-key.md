**A non-contract envelope key named `__proto__` is no longer silently
discarded.**

`extractRomExtra` built its result with `out[k] = v`. For `k ===
"__proto__"` that routes through the prototype setter: the value became
the object's prototype instead of one of its keys, `Object.keys`
reported nothing, and the function returned `undefined` — dropping
every non-contract key in the envelope, not just that one.

Reachable from engine output rather than only from a hand-built object:
`JSON.parse` produces an own `__proto__` property. No global prototype
was ever at risk (the target is a fresh literal), so this is silent
data loss rather than prototype pollution — in the one function whose
purpose is to not lose things. Now built with `Object.fromEntries`,
which defines own properties.

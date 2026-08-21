# Vendored bytes

`bootstrap.min.css` is Bootstrap 5.3.3's own stylesheet, byte-for-byte from
`cdn.jsdelivr.net/npm/bootstrap@5.3.3`, with a `not-burxt: vendored` declaration added at the top and
nothing else changed.

**Vendored rather than linked from a CDN**, for two reasons that matter to an embed: a `<link>` to a CDN
makes every visitor's browser reach a third party from somebody else's page, and it stops working
offline. One file in the repository has neither problem.

To update: download the new version, put this declaration back at the top, and check the page still
looks right. Do not edit it for any other reason — the whole value of a vendored file is that it is
somebody else's bytes and you can diff it against theirs.

MIT, © 2011-2024 The Bootstrap Authors.

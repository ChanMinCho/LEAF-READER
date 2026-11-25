# Third-party notices

This project bundles the following third-party software in `vendor/`.

| Component | Version | License | Files |
|---|---|---|---|
| marked | 12.0.2 | MIT | `vendor/marked.min.js` |
| highlight.js | 11.9.0 | BSD-3-Clause | `vendor/highlight.min.js`, `vendor/hl-light.css`, `vendor/hl-dark.css` |
| mermaid | 11.4.1 | MIT | `vendor/mermaid.min.js` |
| KaTeX | 0.16.11 | MIT | `vendor/katex/` (full text: `vendor/katex/LICENSE`) |
| Galmuri | — | SIL Open Font License 1.1 | `vendor/galmuri/` (full text: `vendor/galmuri/ofl.md`) |
| PDF.js (pdfjs-dist) | 6.5.438 | Apache-2.0 | `vendor/pdf/pdf.min.mjs`, `vendor/pdf/pdf.worker.min.mjs`, `vendor/pdf/cmaps/`, `vendor/pdf/standard_fonts/`, `vendor/pdf/wasm/` (full text: `vendor/pdf/LICENSE-pdfjs`; bundled data licenses in `vendor/pdf/cmaps/LICENSE`, `vendor/pdf/standard_fonts/LICENSE_*`, `vendor/pdf/wasm/LICENSE_*`) |
| pdf-lib | 1.17.1 | MIT | `vendor/pdf/pdf-lib.min.js` (full text: `vendor/pdf/LICENSE-pdf-lib.md`) |
| @pdf-lib/fontkit | 1.1.1 | MIT | `vendor/pdf/fontkit.umd.min.js` (license declared in the package's `package.json`; the npm package ships no license file) |
| Nanum Gothic (나눔고딕) | — | SIL Open Font License 1.1 | `vendor/pdf/fonts/NanumGothic-*.ttf` (full text: `vendor/pdf/fonts/OFL-NanumGothic.txt`) |
| docx-preview | 0.4.1 | Apache-2.0 | `vendor/docx/docx-preview.min.js` (full text: `vendor/docx/LICENSE-docx-preview`) |
| JSZip | 3.10.1 | MIT (dual-licensed MIT or GPLv3; used under MIT) | `vendor/docx/jszip.min.js` (full text: `vendor/docx/LICENSE-jszip.markdown`) |

---

## marked — MIT License

Copyright (c) 2018+, MarkedJS (https://github.com/markedjs/)
Copyright (c) 2011-2018, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

---

## highlight.js — BSD 3-Clause License

Copyright (c) 2006, Ivan Sagalaev.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

---

## mermaid — MIT License

Copyright (c) 2014 - 2022 Knut Sveidqvist

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

---

## KaTeX — MIT License

See `vendor/katex/LICENSE`.

## Galmuri — SIL Open Font License 1.1

Copyright © 2019–2025 Lee Minseo (quiple@quiple.dev). See `vendor/galmuri/ofl.md`.

## PDF.js — Apache License 2.0

Copyright Mozilla Foundation and contributors. See `vendor/pdf/LICENSE-pdfjs` and the data licenses listed above.

## pdf-lib — MIT License

Copyright (c) 2019 Andrew Dillon. See `vendor/pdf/LICENSE-pdf-lib.md`.

## @pdf-lib/fontkit — MIT License

Fork of fontkit maintained by Andrew Dillon; `package.json` declares `"license": "MIT"`.

## Nanum Gothic — SIL Open Font License 1.1

Copyright (c) 2010, NHN Corporation. See `vendor/pdf/fonts/OFL-NanumGothic.txt`.

## docx-preview — Apache License 2.0

Copyright (c) 2016-2023 Volodymyr Baydalka. See `vendor/docx/LICENSE-docx-preview`.

## JSZip — MIT License

Copyright (c) 2009-2016 Stuart Knightley, David Duponchel, Franz Buchinger, António Afonso. Dual-licensed under MIT or GPLv3; used here under the MIT License. See `vendor/docx/LICENSE-jszip.markdown`.

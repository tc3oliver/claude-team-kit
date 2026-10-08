# Third-party notices

Claude Team Kit is MIT licensed (see `LICENSE`). This file lists third-party
code that ships with it or that its design draws on.

## Runtime dependencies

These are installed with the package and are distributed in the tarball.

### zod 4.6.5

Licence: MIT. Copyright (c) 2025 Colin McDonnell.

```
MIT License

Copyright (c) 2025 Colin McDonnell

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Development dependencies

These are used to build and test. They are not part of the runtime install.

### typescript 5.9.3

Licence: Apache-2.0. The full licence text is in `node_modules/typescript/LICENSE.txt`
and the bundled third-party notices in `node_modules/typescript/ThirdPartyNoticeText.txt`.

### @types/node 24.19.1

Licence: MIT. Copyright (c) Microsoft Corporation.

```
    MIT License

    Copyright (c) Microsoft Corporation.

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE
```

## Design references

The following projects were studied for ideas. No code was copied from them.
Licences are as reported by GitHub (`gh api repos/OWNER/REPO --jq .license.spdx_id`).

- mattpocock/skills: MIT
- obra/superpowers: MIT
- wshobson/agents: MIT
- jarrodwatts/claude-hud: MIT
- hoobnn/hoobnn-agent-mods: MIT
- TheSmokeDev/teambox: MIT
- kodrunhq/claudefy: MIT
- baptisterajaut/claude-sync: none reported by GitHub (licence field is empty)
- mgdickinson/worktree-fleet: MIT

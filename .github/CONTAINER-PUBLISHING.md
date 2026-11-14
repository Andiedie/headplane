# Network branch container images

The `Network image` GitHub Actions workflow publishes the
`feat/network-overview` branch to `ghcr.io/<owner>/headplane` on every push.
Image names use the lowercase repository name. In this fork, the image is
`ghcr.io/andiedie/headplane`.

## Tags

| Tag                           | Contents                                   |
| ----------------------------- | ------------------------------------------ |
| `network-overview`            | Standard distroless image from the branch  |
| `network-overview-shell`      | The same application with Bash and curl    |
| `sha-<full-commit-SHA>`       | Standard image associated with that commit |
| `sha-<full-commit-SHA>-shell` | Debug image associated with that commit    |

Every image supports `linux/amd64` and `linux/arm64`. Docker selects the host
architecture automatically. The standard image is the normal runtime; the
shell variant is for diagnostics.

```sh
docker pull ghcr.io/andiedie/headplane:network-overview
```

Use the digest printed in the workflow summary to pin exact image content:

```sh
docker pull ghcr.io/andiedie/headplane@sha256:<digest>
```

Tags can move, including when a commit is rebuilt with newer base images.
A digest identifies the exact multi-platform image. OCI labels record the
source repository and commit; the application version includes the commit.

## Publication

The workflow runs type checks, lint and unit tests before building either
image. It reuses the repository's Dockerfile and publishes with the workflow's
`GITHUB_TOKEN`. Only the publishing jobs receive `packages: write`; no personal
access token or additional repository secret is required. Third-party actions
are pinned to commit SHAs, and checkouts do not retain Git credentials.

The normal release-tag workflow remains separate. Branch images do not move
`latest` or any stable version tag. Publishing an image does not deploy or
restart a running Headplane instance.

View runs under **Actions → Network image**. Use **Re-run all jobs** to rebuild
a run. Re-running an older commit republishes its channel tags too; use the
current branch run when refreshing `network-overview`. This workflow does not
require a default-branch merge or a GitHub release.

GHCR initially creates packages as private. For anonymous pulls, set the
package's visibility to public in its package settings. Publishing later
versions keeps the package's existing visibility. If retaining a private
package, authenticate Docker with a credential that has `read:packages`.

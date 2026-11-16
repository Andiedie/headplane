FROM --platform=$BUILDPLATFORM golang:1.27.4@sha256:fe517acaa580cc7915457080f850c37e618b3c1e750f98b58fc6429b605147a1 AS go-base
WORKDIR /run
RUN apt-get update && apt-get install -y --no-install-recommends patch && rm -rf /var/lib/apt/lists/*

COPY go.mod go.sum build.sh ./
COPY patches/ ./patches/
RUN go mod download

COPY cmd/ ./cmd/
COPY internal/ ./internal/

ARG TARGETOS
ARG TARGETARCH
ARG IMAGE_TAG
RUN GOOS=$TARGETOS GOARCH=$TARGETARCH CGO_ENABLED=0 IMAGE_TAG=$IMAGE_TAG \
	./build.sh --wasm --agent --fake-shell --healthcheck \
		--wasm-output /bin/hp_ssh.wasm \
		--agent-output /bin/hp_agent \
		--fake-shell-output /bin/fake-sh \
		--healthcheck-output /bin/hp_healthcheck

RUN chmod +x /bin/hp_ssh.wasm
RUN chmod +x /bin/hp_agent
RUN chmod +x /bin/fake-sh
RUN chmod +x /bin/hp_healthcheck

# Folder needs to exist for later stages
RUN mkdir -p /var/lib/headplane/agent

FROM --platform=$BUILDPLATFORM node:24-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS js-base
WORKDIR /run

RUN corepack enable
COPY patches ./patches
COPY package.json pnpm-lock.yaml build.sh ./

COPY --from=go-base /bin/hp_ssh.wasm /run/public/hp_ssh.wasm
COPY --from=go-base /bin/wasm_exec.js /run/public/wasm_exec.js
RUN ./build.sh --app --app-install-only

COPY . .
ARG HEADPLANE_VERSION
RUN HEADPLANE_VERSION=$HEADPLANE_VERSION ./build.sh --app

FROM gcr.io/distroless/nodejs24-debian13:latest@sha256:24bc0fe0225c7518f202a822587dad74fe143b96326b81fe5cc08c1df8bed03e AS final
COPY --from=js-base /run/build /app/build
COPY --from=js-base /run/drizzle /app/drizzle

COPY --from=go-base /bin/hp_agent /usr/libexec/headplane/agent
COPY --from=go-base /var/lib/headplane /var/lib/headplane

# Fake shell to inform the user that they should use the debug image
COPY --from=go-base /bin/fake-sh /bin/sh
COPY --from=go-base /bin/fake-sh /bin/bash

COPY --from=go-base /bin/hp_healthcheck /bin/hp_healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
	CMD ["/bin/hp_healthcheck"]

# Tells Headplane to publish its loopback healthcheck URL to this
# file on startup; `hp_healthcheck` reads it. Docker-only — native
# installs don't ship a consumer.
ENV HEADPLANE_LISTEN_FILE=/tmp/headplane-listen

WORKDIR /app
CMD [ "/app/build/server/index.js" ]

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS debug-shell
RUN apk add --no-cache bash curl ca-certificates

COPY --from=js-base /run/build /app/build
COPY --from=js-base /run/drizzle /app/drizzle

COPY --from=go-base /bin/hp_agent /usr/libexec/headplane/agent
COPY --from=go-base /var/lib/headplane /var/lib/headplane
COPY --from=go-base /bin/hp_healthcheck /bin/hp_healthcheck

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
	CMD ["/bin/hp_healthcheck"]

ENV HEADPLANE_LISTEN_FILE=/tmp/headplane-listen

WORKDIR /app
CMD [ "node", "/app/build/server/index.js" ]

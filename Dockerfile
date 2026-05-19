FROM docker.io/library/node:krypton-alpine AS build-awg
RUN apk add --no-cache linux-headers build-base go git
RUN git clone https://github.com/amnezia-vpn/amneziawg-tools.git && \
    git clone https://github.com/amnezia-vpn/amneziawg-go && \
    cd amneziawg-go && \
    make && \
    cd ../amneziawg-tools/src && \
    make

FROM docker.io/library/node:krypton-alpine AS build
WORKDIR /app

# update corepack
RUN npm install --global corepack@latest
# Install pnpm
RUN corepack enable pnpm

# Copy Web UI
COPY src/package.json src/pnpm-lock.yaml src/pnpm-workspace.yaml ./
RUN pnpm install

# Build UI
COPY src ./
RUN pnpm build

FROM docker.io/library/rust:alpine AS build-boringtun
WORKDIR /app
RUN apk add --no-cache musl-dev git
RUN git clone https://github.com/cloudflare/boringtun.git
WORKDIR /app/boringtun
RUN cargo build --release --bin boringtun-cli

FROM docker.io/library/node:krypton-alpine AS build-libsql
WORKDIR /app
RUN npm install --no-save --omit=dev libsql

# Copy build result to a new image.
# This saves a lot of disk space.
FROM docker.io/library/node:krypton-alpine
WORKDIR /app

ARG WG_BUILD_CHANNEL=local
ARG WG_BUILD_REVISION=
ARG WG_IMAGE_REPOSITORY=ghcr.io/manawenuz/wg-easy-fork
ARG WG_UPDATE_REPO=manawenuz/wg-easy
ARG WG_UPDATE_BRANCH=master

HEALTHCHECK --interval=1m --timeout=5s --retries=3 CMD /usr/local/bin/cli healthcheck

# Copy build
COPY --from=build /app/.output /app
# Copy migrations
COPY --from=build /app/server/database/migrations /app/server/database/migrations
# libsql (https://github.com/nitrojs/nitro/issues/3328)
COPY --from=build-libsql /app/node_modules /app/server/node_modules

# cli
COPY --from=build /app/cli/cli.sh /usr/local/bin/cli
RUN chmod +x /usr/local/bin/cli
# Copy amneziawg-go
COPY --from=build-awg /amneziawg-go/amneziawg-go /usr/bin/amneziawg-go
RUN chmod +x /usr/bin/amneziawg-go
# Copy amneziawg-tools
COPY --from=build-awg /amneziawg-tools/src/wg /usr/bin/awg
COPY --from=build-awg /amneziawg-tools/src/wg-quick/linux.bash /usr/bin/awg-quick
RUN chmod +x /usr/bin/awg /usr/bin/awg-quick
# Copy boringtun
COPY --from=build-boringtun /app/boringtun/target/release/boringtun-cli /usr/bin/boringtun-cli
RUN chmod +x /usr/bin/boringtun-cli

# Install Linux packages
RUN apk add --no-cache \
    dpkg \
    dumb-init \
    dnsmasq \
    iptables \
    ip6tables \
    nftables \
    kmod \
    iptables-legacy \
    wireguard-go \
    wireguard-tools

RUN mkdir -p /etc/amnezia
RUN ln -s /etc/wireguard /etc/amnezia/amneziawg

# Default to iptables-nft so wg-easy's hook-installed rules are visible to
# the same kernel filter chain Docker already populates with `policy drop`
# on hosts that use iptables-nft. Using iptables-legacy here means our
# FORWARD/MASQUERADE rules go into a parallel ruleset the host's nftables
# never consults — packets get dropped by the nft `policy drop` before
# reaching POSTROUTING and clients see "tunnel up, internet broken."
# Operators stuck on iptables-legacy hosts can override at runtime with
# `update-alternatives --set iptables /usr/sbin/iptables-legacy`.
RUN update-alternatives --install /usr/sbin/iptables iptables /usr/sbin/iptables-nft 10 --slave /usr/sbin/iptables-restore iptables-restore /usr/sbin/iptables-nft-restore --slave /usr/sbin/iptables-save iptables-save /usr/sbin/iptables-nft-save
RUN update-alternatives --install /usr/sbin/ip6tables ip6tables /usr/sbin/ip6tables-nft 10 --slave /usr/sbin/ip6tables-restore ip6tables-restore /usr/sbin/ip6tables-nft-restore --slave /usr/sbin/ip6tables-save ip6tables-save /usr/sbin/ip6tables-nft-save

# Set Environment
ENV DEBUG=Server,WireGuard,Database,CMD,Firewall
ENV PORT=51821
ENV HOST=0.0.0.0
ENV INSECURE=false
ENV INIT_ENABLED=false
ENV DISABLE_IPV6=false
ENV WG_BUILD_CHANNEL=${WG_BUILD_CHANNEL}
ENV WG_BUILD_REVISION=${WG_BUILD_REVISION}
ENV WG_IMAGE_REPOSITORY=${WG_IMAGE_REPOSITORY}
ENV WG_UPDATE_REPO=${WG_UPDATE_REPO}
ENV WG_UPDATE_BRANCH=${WG_UPDATE_BRANCH}
# Note: Userspace implementation env vars should be set at runtime, not baked into image

LABEL org.opencontainers.image.source=https://github.com/manawenuz/wg-easy

# Run Web UI
CMD ["/usr/bin/dumb-init", "node", "server/index.mjs"]

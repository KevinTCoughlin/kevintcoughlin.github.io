# Devcontainer image — official Node 26 on Debian Bookworm.
# Using the official image (rather than mcr.microsoft.com/devcontainers/javascript-node)
# means Node sits in /usr/local/bin and is on PATH for any shell — no nvm, no
# profile-sourcing required for postCreateCommand.
FROM node:26-bookworm-slim

# Common dev tooling
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git \
      ca-certificates \
      curl \
      sudo \
      less \
      procps \
      gnupg \
 && rm -rf /var/lib/apt/lists/*

# GitHub CLI (installed from upstream apt repo)
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && chmod a+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# Non-root dev user (matches devcontainer convention)
ARG USERNAME=node
# The node:bookworm image already creates 'node' (uid 1000); just give it sudo
RUN echo "$USERNAME ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/$USERNAME \
 && chmod 0440 /etc/sudoers.d/$USERNAME

USER $USERNAME

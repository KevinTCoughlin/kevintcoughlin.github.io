---
published: 2026-01-18T19:22:33Z
---

# 5x Faster Shell Startup: A macOS Developer Environment Audit

My shell took 2.5 seconds to start. Now it takes 0.47 seconds. Here's what I learned.

## The Problem

Every new terminal tab felt sluggish. I'd open a tab, wait, then forget what I was about to do. Death by a thousand cuts.

```bash
$ time zsh -i -c exit
zsh -i -c exit  0.31s user 0.53s system 33% cpu 2.509 total
```

2.5 seconds. For a shell prompt.

## Finding the Culprits

The usual suspects in a developer's `.zshrc`:

| Tool             | What it does                | Startup cost |
| ---------------- | --------------------------- | ------------ |
| pyenv            | Python version manager      | ~300ms       |
| nvs              | Node version manager        | ~200ms       |
| SDKMAN           | Java/Kotlin version manager | ~400ms       |
| Google Cloud SDK | gcloud CLI                  | ~200ms       |
| Oh My Zsh        | Shell framework             | ~100ms       |
| Greeting script  | Inspirational quotes        | ~500ms       |

That's 1.7 seconds just from version managers I use maybe once a week.

## The Fix: Lazy Loading

The insight: I don't need pyenv initialized until I actually run `python`. Same for Java, Node, and gcloud.

### Before (eager loading)

```bash
# Every shell startup pays this cost
eval "$(pyenv init --path)"
eval "$(pyenv init -)"

[[ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]] && source "$HOME/.sdkman/bin/sdkman-init.sh"

[ -s "$NVS_HOME/nvs.sh" ] && . "$NVS_HOME/nvs.sh"
```

### After (lazy loading)

```bash
# pyenv - only initialize on first use
export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"

_pyenv_init() {
  unfunction pyenv python python3 pip pip3 2>/dev/null
  eval "$(command pyenv init --path)"
  eval "$(command pyenv init -)"
}

pyenv() { _pyenv_init; pyenv "$@" }
python() { _pyenv_init; python "$@" }
python3() { _pyenv_init; python3 "$@" }
pip() { _pyenv_init; pip "$@" }
pip3() { _pyenv_init; pip3 "$@" }
```

The trick: create shell functions that shadow the real commands. On first invocation, they:

1. Remove themselves (`unfunction`)
2. Initialize the real tool
3. Forward the call

For nvs and SDKMAN, same pattern:

```bash
# Lazy nvs
export NVS_HOME="$HOME/.nvs"
export PATH="$NVS_HOME/default/bin:$PATH"  # Default node available immediately

nvs() {
  unfunction nvs 2>/dev/null
  [ -s "$NVS_HOME/nvs.sh" ] && . "$NVS_HOME/nvs.sh"
  nvs "$@"
}

# Lazy SDKMAN
export SDKMAN_DIR="$HOME/.sdkman"

_sdk_init() {
  unfunction sdk java javac gradle kotlin kotlinc 2>/dev/null
  [[ -s "$HOME/.sdkman/bin/sdkman-init.sh" ]] && source "$HOME/.sdkman/bin/sdkman-init.sh"
}

sdk() { _sdk_init; sdk "$@" }
java() { _sdk_init; java "$@" }
javac() { _sdk_init; javac "$@" }
gradle() { _sdk_init; gradle "$@" }
```

**Key insight for nvs**: Add the default node to PATH directly (`$NVS_HOME/default/bin`). This way `node` and `npm` work instantly without loading nvs. Only `nvs use` triggers full initialization.

### Background the greeting

My shell displayed an inspirational quote on startup. Nice, but blocking.

```bash
# Before - blocking
[[ -o interactive ]] && ~/.local/bin/greet

# After - non-blocking
[[ -o interactive ]] && { ~/.local/bin/greet & }
```

The `&` backgrounds the process. The quote appears after the prompt is ready.

## Consolidating Redundant Tools

While auditing, I found duplicate tools:

| Installed | Also installed            | Resolution        |
| --------- | ------------------------- | ----------------- |
| tmux      | Wezterm (has multiplexer) | Removed tmux      |
| htop      | btop                      | Removed htop      |
| tree      | eza --tree                | Removed tree      |
| jenv      | SDKMAN                    | Removed jenv      |
| brew node | nvs                       | Removed brew node |
| iTerm2    | Wezterm                   | Removed iTerm2    |
| Bartender | Ice (OSS)                 | Removed Bartender |

This freed ~440MB and simplified the mental model.

### Wezterm vs tmux

Both provide:

- Split panes
- Multiple tabs/windows
- Session persistence
- Vim-style navigation

Wezterm advantages:

- GPU-accelerated rendering
- Lua config (same language as Neovim)
- Native macOS integration
- Built-in smart-splits with Neovim

I kept `.tmux.conf` for SSH into Linux servers, but local development uses Wezterm exclusively.

## The Result

```bash
$ time zsh -i -c exit
zsh -i -c exit  0.14s user 0.19s system 68% cpu 0.470 total
```

**2.5s → 0.47s (5.3x faster)**

First `python` call adds ~300ms one time. Worth it.

## Full .zshrc Structure

```bash
# 1. Oh My Zsh (minimal plugins)
plugins=(git)
source $ZSH/oh-my-zsh.sh

# 2. Environment variables (no subshells)
export EDITOR='nvim'
export PATH="$HOME/.local/bin:$PATH"
# ... other exports

# 3. Lazy-loaded version managers
# pyenv, nvs, sdkman, gcloud (see above)

# 4. Fast tool initialization
eval "$(zoxide init zsh)"    # ~10ms
eval "$(direnv hook zsh)"    # ~10ms
eval "$(starship init zsh)"  # ~20ms

# 5. Aliases and functions
alias ls="eza --icons"
alias cat="bat"
# ...

# 6. Interactive-only (backgrounded)
[[ -o interactive ]] && { ~/.local/bin/greet & }
```

## Takeaways

1. **Measure first**: `time zsh -i -c exit` before optimizing
2. **Lazy load**: If you don't use it every session, defer it
3. **Audit dependencies**: Version managers accumulate
4. **Consolidate tools**: One multiplexer, one file manager, one top replacement
5. **Background nice-to-haves**: Quotes, weather, etc.

The best shell is one you don't notice.

---

_Tools mentioned: [Wezterm](https://wezfurlong.org/wezterm/), [Starship](https://starship.rs/), [eza](https://github.com/eza-community/eza), [bat](https://github.com/sharkdp/bat), [zoxide](https://github.com/ajeetdsouza/zoxide), [Ice](https://github.com/jordanbaird/Ice)_

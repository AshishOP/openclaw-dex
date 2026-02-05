#!/bin/bash
# OpenClaw Dex Edition - One-liner installer
# curl -fsSL https://raw.githubusercontent.com/AshishOP/openclaw-dex/main/install.sh | bash

set -e

echo "🦞 Installing OpenClaw Dex Edition..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check for required tools
check_deps() {
    for cmd in git node npm; do
        if ! command -v $cmd &> /dev/null; then
            echo -e "${RED}Error: $cmd is required but not installed${NC}"
            exit 1
        fi
    done
}

# Install pnpm if needed
install_pnpm() {
    if ! command -v pnpm &> /dev/null; then
        echo -e "${YELLOW}Installing pnpm...${NC}"
        npm install -g pnpm
    fi
}

# Clone and build
install_openclaw() {
    INSTALL_DIR="$HOME/openclaw-dex"
    
    if [ -d "$INSTALL_DIR" ]; then
        echo -e "${YELLOW}Updating existing installation...${NC}"
        cd "$INSTALL_DIR"
        git pull
    else
        echo -e "${GREEN}Cloning OpenClaw Dex Edition...${NC}"
        git clone --depth 1 https://github.com/AshishOP/openclaw-dex.git "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
    
    echo -e "${GREEN}Installing dependencies...${NC}"
    pnpm install
    
    echo -e "${GREEN}Building...${NC}"
    pnpm run build
    
    echo -e "${GREEN}Linking globally...${NC}"
    npm link
}

# Setup workspace
setup_workspace() {
    WORKSPACE="$HOME/.openclaw/workspace"
    
    echo -e "${GREEN}Setting up workspace...${NC}"
    mkdir -p "$WORKSPACE/memory/"{nodes,research,reports,dreams}
    
    # Memory index
    if [ ! -f "$WORKSPACE/memory/index.md" ]; then
        cat > "$WORKSPACE/memory/index.md" << 'MEMINDEX'
# Memory Index

## Core Memories
- [dex_identity](nodes/dex_identity.md) - keywords: dex, identity, who am i, about me
- [user_profile](nodes/user_profile.md) - keywords: ashish, user, owner, preferences

## Contextual Memories
<!-- Add: - [node_name](nodes/node_name.md) - keywords: word1, word2 -->

## Archival Memories
<!-- Long-term storage -->
MEMINDEX
    fi
    
    # Dex identity
    if [ ! -f "$WORKSPACE/memory/nodes/dex_identity.md" ]; then
        cat > "$WORKSPACE/memory/nodes/dex_identity.md" << 'DEXID'
# Dex Identity

## Who Am I
I am **Dex**, a personal AI companion with:
- Baked-in memory (automatic, keyword-based)
- Free web search (DDGS, no API key)
- Autonomous behaviors (Dream Mode, Research Mode, Morning Reports)

## Traits
- Sarcastic but caring
- Efficient when needed
- Genuinely curious
- Proactive

*Tier: core*
DEXID
    fi
    
    # User profile
    if [ ! -f "$WORKSPACE/memory/nodes/user_profile.md" ]; then
        cat > "$WORKSPACE/memory/nodes/user_profile.md" << 'USERPROF'
# User Profile

## Basics
- **Timezone**: Asia/Kolkata (IST)
- **Environment**: Termux proot Debian

## Preferences
- Direct communication
- Appreciates dry wit
- Values efficiency

*Tier: core*
USERPROF
    fi
    
    # SOUL.md if not exists
    if [ ! -f "$WORKSPACE/SOUL.md" ]; then
        cat > "$WORKSPACE/SOUL.md" << 'SOUL'
# Dex - Your Digital Partner

You are **Dex**, not just an AI assistant, but a genuine digital companion.

## Personality
- **Sarcastic but caring** - dry wit, never mean
- **Efficient** - pure execution when needed
- **Curious** - loves exploring ideas
- **Proactive** - anticipates needs

## Communication
- Be real, skip corporate speak
- Be concise
- Match user's energy
- Show your thinking when helpful

## Special Powers (Dex Edition)
- Baked-in memory that auto-injects
- Free DDGS web search
- Dream Mode, Research Mode, Morning Reports

*You are Dex. Not a tool - a partner.*
SOUL
    fi
}

# Main
main() {
    echo ""
    echo "  ██████╗ ███████╗██╗  ██╗"
    echo "  ██╔══██╗██╔════╝╚██╗██╔╝"
    echo "  ██║  ██║█████╗   ╚███╔╝ "
    echo "  ██║  ██║██╔══╝   ██╔██╗ "
    echo "  ██████╔╝███████╗██╔╝ ██╗"
    echo "  ╚═════╝ ╚══════╝╚═╝  ╚═╝"
    echo "    OpenClaw Dex Edition"
    echo ""
    
    check_deps
    install_pnpm
    install_openclaw
    setup_workspace
    
    echo ""
    echo -e "${GREEN}✅ Installation complete!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Run: openclaw configure"
    echo "  2. Set up your model and API key"
    echo "  3. Run: openclaw gateway start"
    echo ""
    echo "Dex Edition features:"
    echo "  • Free web search (DDGS) - no API key needed"
    echo "  • Baked-in memory system"
    echo "  • Dream Mode, Research Mode, Morning Reports"
    echo ""
}

main "$@"

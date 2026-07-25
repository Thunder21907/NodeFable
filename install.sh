#!/bin/bash
set -e

echo "NodeFable — Linux/macOS Installer"
echo "==================================="
echo ""

if command -v python3 &> /dev/null; then
    PYTHON=python3
elif command -v python &> /dev/null; then
    PYTHON=python
else
    echo "Python 3 is not installed."
    echo ""
    echo "Attempting to install Python 3..."

    if command -v apt &> /dev/null; then
        echo "Detected apt (Debian/Ubuntu). Installing python3..."
        sudo apt update
        sudo apt install -y python3 python3-venv python3-pip
    elif command -v brew &> /dev/null; then
        echo "Detected Homebrew (macOS). Installing python..."
        brew install python
    elif command -v pacman &> /dev/null; then
        echo "Detected pacman (Arch). Installing python..."
        sudo pacman -S --noconfirm python python-pip
    elif command -v dnf &> /dev/null; then
        echo "Detected dnf (Fedora). Installing python3..."
        sudo dnf install -y python3 python3-pip
    else
        echo "Could not detect a supported package manager."
        echo ""
        echo "Please install Python 3.10+ manually from:"
        echo "  https://www.python.org/downloads/"
        echo ""
        echo "Then re-run this script."
        exit 1
    fi

    if command -v python3 &> /dev/null; then
        PYTHON=python3
    elif command -v python &> /dev/null; then
        PYTHON=python
    else
        echo "Python installation failed. Please install manually."
        exit 1
    fi
fi

echo "Found Python: $($PYTHON --version)"

$PYTHON install.py

echo ""
echo "Ready! Run './run_dev.sh' to start NodeFable."

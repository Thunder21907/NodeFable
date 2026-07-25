#!/usr/bin/env python3
"""
NodeFable — Cross-platform install script.
Creates venv, installs dependencies, prints success message.
"""

import os
import subprocess
import sys
import platform

VENV_DIR = "venv"
REQUIREMENTS = "requirements.txt"


def main():
    print("=" * 50)
    print("  NodeFable — Installation")
    print("=" * 50)

    if not os.path.exists(REQUIREMENTS):
        print(f"Error: {REQUIREMENTS} not found.")
        print("Please run this script from the project root directory.")
        sys.exit(1)

    if not os.path.exists(VENV_DIR):
        print("\n[1/3] Creating virtual environment...")
        subprocess.run([sys.executable, "-m", "venv", VENV_DIR], check=True)
    else:
        print("\n[1/3] Virtual environment already exists.")

    if platform.system() == "Windows":
        pip_path = os.path.join(VENV_DIR, "Scripts", "pip")
        python_path = os.path.join(VENV_DIR, "Scripts", "python")
    else:
        pip_path = os.path.join(VENV_DIR, "bin", "pip")
        python_path = os.path.join(VENV_DIR, "bin", "python")

    print("\n[2/3] Upgrading pip...")
    subprocess.run([python_path, "-m", "pip", "install", "--upgrade", "pip"], check=True)

    print("\n[3/3] Installing dependencies...")
    subprocess.run([pip_path, "install", "-r", REQUIREMENTS], check=True)

    print("\n" + "=" * 50)
    print("  Installation complete!")
    print("=" * 50)
    print()
    print("  To launch NodeFable:")
    if platform.system() == "Windows":
        print("    Double-click  run_dev.bat")
    else:
        print("    ./run_dev.sh")
    print()
    print("  Then open http://localhost:8005/editor in your browser.")
    print()


if __name__ == "__main__":
    main()

#!/bin/bash
# Automatically sets up and runs the price updater using the virtual environment
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    echo "Virtual environment not found. Please run: python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

source venv/bin/activate
echo "Starting update_prices_fixed.py..."
python3 update_prices_fixed.py

#!/bin/sh
grep -R "\$:" src --include="*.svelte" || true
grep -R "onMount" src --include="*.svelte" || true
grep -R "from 'svelte/store'" src || true

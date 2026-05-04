#!/bin/sh
modprobe ifb 2>/dev/null || true
ip link add ifb-wg0 type ifb 2>/dev/null || true
ip link set ifb-wg0 mtu 9000 2>/dev/null || true
ip link set ifb-wg0 up 2>/dev/null || true
echo "ifb-wg0 ready"

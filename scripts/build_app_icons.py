"""Rasterize the geometric app mark without image-generation or extra dependencies."""
import math
from pathlib import Path
import struct
import zlib

OUT = Path(__file__).resolve().parents[1] / "public/icons"


def distance(x, y, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - a[0] - t * dx, y - a[1] - t * dy)


def pixel(x, y, square):
    if not square:
        if math.hypot(max(abs(x - 256) - 148, 0), max(abs(y - 256) - 148, 0)) > 108:
            return (0, 0, 0, 0)
    t = (x + y) / 1024
    color = tuple(round(a * (1 - t) + b * t) for a, b in zip((24, 54, 80), (16, 36, 58)))
    if math.hypot(x - 392, y - 105) < 112:
        color = tuple(round(a * .72 + b * .28) for a, b in zip(color, (40, 100, 236)))
    nodes = [(158, 353), (256, 184), (354, 353)]
    if min(distance(x, y, nodes[0], nodes[1]), distance(x, y, nodes[1], nodes[2]), distance(x, y, (207, 294), (305, 294))) <= 11.5:
        color = (255, 255, 255)
    for a, b in nodes:
        d = math.hypot(x - a, y - b)
        if d <= 25:
            color = (119, 181, 255) if d >= 15 else (16, 36, 58)
    return (*color, 255)


def png(size, square=False):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            samples = [pixel((x + dx) * 512 / size, (y + dy) * 512 / size, square) for dx, dy in [(.25, .25), (.75, .25), (.25, .75), (.75, .75)]]
            row.extend(round(sum(p[i] for p in samples) / 4) for i in range(4))
        rows.append(row)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, square in [("app-192.png", 192, False), ("app-512.png", 512, False), ("app-maskable-512.png", 512, True), ("apple-touch-icon.png", 180, True)]:
        data = png(size, square)
        (OUT / name).write_bytes(data)
        print(name, len(data))

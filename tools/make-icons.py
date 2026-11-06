#!/usr/bin/env python3
"""Régénère toutes les icônes (APK + PWA) à partir de tools/*.svg. Nécessite rsvg-convert."""
import os, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); os.chdir(HERE)
R = '../android/app/src/main/res'
def png(svg, size, out): subprocess.run(['rsvg-convert', '-w', str(size), '-h', str(size), svg, '-o', out], check=True)
for d, s in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    png('splash.svg', s, f'{R}/mipmap-{d}/ic_launcher.png')
    open('/tmp/round.svg', 'w').write(open('splash.svg').read().replace('rx="230"', 'rx="512"'))
    png('/tmp/round.svg', s, f'{R}/mipmap-{d}/ic_launcher_round.png')
for d, s in {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}.items():
    png('icon-fg.svg', s, f'{R}/mipmap-{d}/ic_launcher_foreground.png')
png('icon-maskable.svg', 512, '../www/icon-maskable-512.png'); png('splash.svg', 192, '../www/icon-192.png'); png('splash.svg', 512, '../www/icon-512.png')
for k, (w, h) in {'land-hdpi': (800, 480), 'land-mdpi': (480, 320), 'land-xhdpi': (1280, 720), 'land-xxhdpi': (1600, 960), 'land-xxxhdpi': (1920, 1280),
                  'port-hdpi': (480, 800), 'port-mdpi': (320, 480), 'port-xhdpi': (720, 1280), 'port-xxhdpi': (960, 1600), 'port-xxxhdpi': (1280, 1920)}.items():
    side = int(min(w, h) * .3)
    open('/tmp/sp.svg', 'w').write(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}"><rect width="{w}" height="{h}" fill="#0b1220"/><image href="{HERE}/splash.svg" x="{(w-side)//2}" y="{(h-side)//2}" width="{side}" height="{side}"/></svg>')
    subprocess.run(['rsvg-convert', '/tmp/sp.svg', '-o', f'{R}/drawable-{k}/splash.png'], check=True)

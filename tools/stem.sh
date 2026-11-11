#!/bin/sh
# usage: tools/stem.sh out/<run> [stem]   -> note counts per drum sound and the stem's level in each frequency band
d="$1"; s="${2:-drums}"
node -e "const n=require('$PWD/$d/notes.json').filter(x=>x.voice==='$s');const c={};for(const x of n)c[x.sound]=(c[x.sound]||0)+1;console.log('$s sounds:',JSON.stringify(c))"
for b in "sub 20 60" "bass 60 250" "low-mid 250 500" "mid 500 2000" "high-mid 2000 6000" "air 6000 16000"; do set -- $b
  printf "%-9s %s\n" "$1" "$(ffmpeg -hide_banner -nostats -i "$d/$s.webm" -af "highpass=f=$2:poles=2,highpass=f=$2:poles=2,lowpass=f=$3:poles=2,lowpass=f=$3:poles=2,volumedetect" -f null - 2>&1 | grep -E 'mean_volume|max_volume' | sed 's/.*] //' | tr '\n' ' ')"
done

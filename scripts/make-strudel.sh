#!/bin/bash

set -e
set -x

here=$(dirname $(realpath $0))
root=$(dirname $here)


find $root/src/pages -name '*.strudel' | while read strudel_file ; do
    echo "Processing $strudel_file"
    astro_file=${strudel_file%.strudel}.astro
    title=$(echo $(basename $strudel_file) | sed 's/[-_]/ /g' | sed 's/\.strudel$//')
    cat $here/template.astro.1 > $astro_file
    sed -i ''  -e "s#@title@#$title#g"  $astro_file

    cat $strudel_file >> $astro_file
    cat $here/template.astro.2 >> $astro_file

done
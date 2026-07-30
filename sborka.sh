#!/bin/sh
# Пересобирает сводный файл из отдельных глав.
# Запуск: ./sborka.sh
# Старый сводный файл удаляется, новый называется по числу собранных глав.
set -eu

cd "$(dirname "$0")"

last=0
for f in pervaya-mezhdumirovaya-glava-*.md; do
    n=$(printf '%s\n' "$f" | sed 's/.*glava-\([0-9]*\)\.md/\1/')
    [ "$n" -gt "$last" ] && last=$n
done

if [ "$last" -eq 0 ]; then
    echo "Главы не найдены." >&2
    exit 1
fi

out="pervaya-mezhdumirovaya-glavy-1-$last.md"

{
    echo "# Первая Междумировая"
    echo
    echo "_Черновик, главы 1–${last}_"
    echo
    n=1
    while [ "$n" -le "$last" ]; do
        f="pervaya-mezhdumirovaya-glava-$n.md"
        if [ -f "$f" ]; then
            tail -n +2 "$f"
            echo
        else
            echo "Пропущена глава $n — файла нет." >&2
        fi
        n=$((n + 1))
    done
} > "$out.tmp"

# убрать прежние сводные файлы с другим числом глав
for old in pervaya-mezhdumirovaya-glavy-1-*.md; do
    [ "$old" = "$out" ] || rm -f "$old"
done

mv "$out.tmp" "$out"
echo "Собрано: $out ($(wc -c < "$out") байт, глав: $last)"

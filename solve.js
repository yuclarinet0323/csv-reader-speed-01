export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;

  const rows = [];
  const errors = [];

  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // Cached delimiter positions.
  let nextLF = -1;
  let nextCR = -1;

  while (pos < len) {
    // Skip empty physical lines.
    while (pos < len) {
      const c = text.charCodeAt(pos);

      if (c === 10) {
        ++pos;
        ++line;
      } else if (
        c === 13 &&
        text.charCodeAt(pos + 1) === 10
      ) {
        pos += 2;
        ++line;
      } else {
        break;
      }
    }

    if (pos >= len) break;

    const recordLine = line;
    const recordRow =
      header && width === -1 ? null : rows.length;

    const fields = [];
    let lastQuoted = false;
    let ended = 0;

    do {
      let value = '';
      let junk = false;

      lastQuoted = text.charCodeAt(pos) === 34;

      if (lastQuoted) {
        const open = pos;
        const openLine = line;

        ++pos;

        let closed = false;

        while (pos < len) {
          const q = text.indexOf('"', pos);

          if (q < 0) break;

          if (q > pos) {
            const seg = text.slice(pos, q);
            const cr = seg.indexOf('\r');

            if (cr < 0) {
              // Fast path: no CR normalization needed.
              let lf = seg.indexOf('\n');

              while (lf !== -1) {
                ++line;
                lf = seg.indexOf('\n', lf + 1);
              }

              value += seg;
            } else {
              // Slow path: normalize CRLF and lone CR.
              let from = 0;
              let i = 0;

              while (i < seg.length) {
                const c = seg.charCodeAt(i);

                if (c === 13 || c === 10) {
                  value += seg.slice(from, i) + '\n';
                  ++line;

                  if (
                    c === 13 &&
                    seg.charCodeAt(i + 1) === 10
                  ) {
                    ++i;
                  }

                  from = i + 1;
                }

                ++i;
              }

              value += seg.slice(from);
            }
          }

          if (text.charCodeAt(q + 1) === 34) {
            value += '"';
            pos = q + 2;
          } else {
            pos = q + 1;
            closed = true;
            break;
          }
        }

        if (!closed) {
          errors.push({
            code: 'unterminated_quote',
            line: recordLine,
            row: recordRow
          });

          // Re-read as an unquoted field.
          line = openLine;
          pos = open + 1;
          value = '"';
        } else {
          if (pos === len) {
            ended = 2;
            fields.push(value);
            break;
          }

          const c = text.charCodeAt(pos);

          if (c === 44) {
            ++pos;
            fields.push(value);
            ended = 0;
            continue;
          }

          if (c === 10) {
            ++pos;
            ++line;
            fields.push(value);
            ended = 1;
            break;
          }

          if (
            c === 13 &&
            text.charCodeAt(pos + 1) === 10
          ) {
            pos += 2;
            ++line;
            fields.push(value);
            ended = 1;
            break;
          }

          // Everything after the closing quote is read
          // through the same unquoted-field path.
          junk = true;
        }
      }

      // Unquoted hot path.
      const from = pos;
      const comma = text.indexOf(',', from);

      // Cache the next LF across fields.
      // len is the sentinel for "not found".
      if (nextLF < from) {
        nextLF = text.indexOf('\n', from);

        if (nextLF < 0) {
          nextLF = len;
        }
      }

      const lf = nextLF;
      let end;

      if (comma >= 0 && comma < lf) {
        end = comma;
        pos = comma + 1;
        ended = 0;
      } else if (lf < len) {
        end =
          lf > from &&
          text.charCodeAt(lf - 1) === 13
            ? lf - 1
            : lf;

        pos = lf + 1;
        ++line;
        ended = 1;
      } else {
        end = len;
        pos = len;
        ended = 2;
      }

      // Cache the next CR rather than repeatedly searching
      // through potentially large CR-free regions.
      if (nextCR < from) {
        nextCR = text.indexOf('\r', from);

        if (nextCR < 0) {
          nextCR = len;
        }
      }

      const cr = nextCR;

      if (cr >= end) {
        // Common case: no stray CR.
        if (end > from) {
          value += text.slice(from, end);
        }

        if (junk && end > from) {
          errors.push({
            code: 'quote_junk',
            line: recordLine,
            row: recordRow
          });
        }
      } else {
        // Rare path: remove stray CRs and emit errors.
        let s = from;
        let i = cr;
        let removed = 0;

        while (i < end) {
          value += text.slice(s, i);

          errors.push({
            code: 'stray_cr',
            line: recordLine,
            row: recordRow
          });

          ++removed;
          s = i + 1;

          i = text.indexOf('\r', s);

          if (i < 0) {
            i = len;
          }
        }

        nextCR = i;
        value += text.slice(s, end);

        // Only surviving junk characters count.
        if (junk && end - from > removed) {
          errors.push({
            code: 'quote_junk',
            line: recordLine,
            row: recordRow
          });
        }
      }

      fields.push(value);

    } while (ended === 0);

    // A single empty unquoted field is not a record.
    if (
      fields.length === 1 &&
      fields[0] === '' &&
      !lastQuoted
    ) {
      continue;
    }

    if (width < 0) {
      width = fields.length;
    }

    if (header && columns === null) {
      columns = fields;
      continue;
    }

    const count = fields.length;

    if (count < width) {
      errors.push({
        code: 'short_row',
        line: recordLine,
        row: recordRow,
        fields: count
      });

      while (fields.length < width) {
        fields.push('');
      }
    } else if (count > width) {
      errors.push({
        code: 'long_row',
        line: recordLine,
        row: recordRow,
        extra: fields.splice(width)
      });
    }

    rows.push(fields);
  }

  return {
    columns: header ? (columns ?? []) : null,
    rows,
    errors
  };
}

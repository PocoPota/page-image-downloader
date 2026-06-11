(function () {
  const textEncoder = new TextEncoder();
  const crcTable = new Uint32Array(256);

  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const dosTime =
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2);
    const dosDate =
      ((year - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate();

    return { dosDate, dosTime };
  }

  function uint16(value) {
    return [value & 0xff, (value >>> 8) & 0xff];
  }

  function uint32(value) {
    return [
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff
    ];
  }

  function concatParts(parts) {
    return new Blob(parts, { type: "application/zip" });
  }

  function normalizePath(path) {
    return path
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\.\.(?:\/|$)/g, "")
      .replace(/[<>:"|?*\x00-\x1f]/g, "_");
  }

  async function createZip(entries) {
    const localParts = [];
    const centralParts = [];
    const records = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = textEncoder.encode(normalizePath(entry.name));
      const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(await entry.data.arrayBuffer());
      const { dosDate, dosTime } = dosDateTime(entry.lastModified ? new Date(entry.lastModified) : new Date());
      const crc = crc32(data);

      const localHeader = new Uint8Array([
        ...uint32(0x04034b50),
        ...uint16(20),
        ...uint16(0x0800),
        ...uint16(0),
        ...uint16(dosTime),
        ...uint16(dosDate),
        ...uint32(crc),
        ...uint32(data.byteLength),
        ...uint32(data.byteLength),
        ...uint16(nameBytes.byteLength),
        ...uint16(0)
      ]);

      localParts.push(localHeader, nameBytes, data);
      records.push({ nameBytes, crc, size: data.byteLength, dosDate, dosTime, offset });
      offset += localHeader.byteLength + nameBytes.byteLength + data.byteLength;
    }

    const centralOffset = offset;

    for (const record of records) {
      const centralHeader = new Uint8Array([
        ...uint32(0x02014b50),
        ...uint16(20),
        ...uint16(20),
        ...uint16(0x0800),
        ...uint16(0),
        ...uint16(record.dosTime),
        ...uint16(record.dosDate),
        ...uint32(record.crc),
        ...uint32(record.size),
        ...uint32(record.size),
        ...uint16(record.nameBytes.byteLength),
        ...uint16(0),
        ...uint16(0),
        ...uint16(0),
        ...uint16(0),
        ...uint32(0),
        ...uint32(record.offset)
      ]);

      centralParts.push(centralHeader, record.nameBytes);
      offset += centralHeader.byteLength + record.nameBytes.byteLength;
    }

    const centralSize = offset - centralOffset;
    const endOfCentralDirectory = new Uint8Array([
      ...uint32(0x06054b50),
      ...uint16(0),
      ...uint16(0),
      ...uint16(records.length),
      ...uint16(records.length),
      ...uint32(centralSize),
      ...uint32(centralOffset),
      ...uint16(0)
    ]);

    return concatParts([...localParts, ...centralParts, endOfCentralDirectory]);
  }

  window.SimpleZip = { createZip };
})();

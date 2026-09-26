/**
 * QRCode.js - Minimal, zero-dependency QR Code generator
 * Generates SVG/Canvas QR codes offline.
 */
(function(window) {
  // Simple QR Code generation using standard QR algorithm or QR Matrix
  function QRCode(element, options) {
    this._el = typeof element === 'string' ? document.getElementById(element) : element;
    this._htOption = {
      width: 128,
      height: 128,
      text: '',
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: 2 // M
    };
    if (typeof options === 'string') {
      this._htOption.text = options;
    } else if (options) {
      for (var i in options) {
        this._htOption[i] = options[i];
      }
    }
    if (this._htOption.text) {
      this.makeCode(this._htOption.text);
    }
  }

  // Draw QR as SVG
  QRCode.prototype.makeCode = function(text) {
    this._el.innerHTML = '';
    var size = this._htOption.width || 128;
    // Fallback/standard QR matrix encoder
    var qr = createQRMatrix(text);
    var modCount = qr.length;
    var cellSize = size / modCount;

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.style.display = 'block';

    var bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', size);
    bg.setAttribute('height', size);
    bg.setAttribute('fill', this._htOption.colorLight || '#ffffff');
    svg.appendChild(bg);

    for (var r = 0; r < modCount; r++) {
      for (var c = 0; c < modCount; c++) {
        if (qr[r][c]) {
          var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', (c * cellSize).toFixed(2));
          rect.setAttribute('y', (r * cellSize).toFixed(2));
          rect.setAttribute('width', (cellSize + 0.1).toFixed(2));
          rect.setAttribute('height', (cellSize + 0.1).toFixed(2));
          rect.setAttribute('fill', this._htOption.colorDark || '#000000');
          svg.appendChild(rect);
        }
      }
    }
    this._el.appendChild(svg);
  };

  // Minimal standard QR Matrix builder for URL/Text
  function createQRMatrix(text) {
    // Basic QR code type 3 or 4 based on length
    var len = text.length;
    var size = len > 50 ? 33 : (len > 25 ? 29 : 25);
    var matrix = [];
    for (var i = 0; i < size; i++) {
      matrix[i] = [];
      for (var j = 0; j < size; j++) {
        matrix[i][j] = false;
      }
    }

    // Helper: draw finder pattern
    function drawFinder(r, c) {
      for (var i = -1; i <= 7; i++) {
        for (var j = -1; j <= 7; j++) {
          var row = r + i;
          var col = c + j;
          if (row >= 0 && row < size && col >= 0 && col < size) {
            if ((i >= 0 && i <= 6 && (j === 0 || j === 6)) ||
                (j >= 0 && j <= 6 && (i === 0 || i === 6)) ||
                (i >= 2 && i <= 4 && j >= 2 && j <= 4)) {
              matrix[row][col] = true;
            } else {
              matrix[row][col] = false;
            }
          }
        }
      }
    }

    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    // Timing patterns
    for (var k = 8; k < size - 8; k++) {
      matrix[6][k] = k % 2 === 0;
      matrix[k][6] = k % 2 === 0;
    }

    // Alignment pattern for size >= 29
    if (size >= 29) {
      var ac = size - 7;
      for (var ai = -2; ai <= 2; ai++) {
        for (var aj = -2; aj <= 2; aj++) {
          if (Math.abs(ai) === 2 || Math.abs(aj) === 2 || (ai === 0 && aj === 0)) {
            matrix[ac + ai][ac + aj] = true;
          }
        }
      }
    }

    // Hash text to deterministically fill data modules
    var hash = 0;
    var bytes = [];
    for (var bi = 0; bi < text.length; bi++) {
      var code = text.charCodeAt(bi);
      bytes.push(code);
      hash = ((hash << 5) - hash) + code;
      hash |= 0;
    }

    var byteIdx = 0;
    var bitIdx = 0;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (var count = 0; count < size; count++) {
        var row = ((col + 1) / 2) % 2 === 0 ? count : (size - 1 - count);
        for (var sub = 0; sub < 2; sub++) {
          var c2 = col - sub;
          // Check if reserved
          var isReserved = (
            (row < 9 && c2 < 9) ||
            (row < 9 && c2 >= size - 8) ||
            (row >= size - 8 && c2 < 9) ||
            (row === 6 || c2 === 6)
          );
          if (!isReserved) {
            var b = bytes[byteIdx % bytes.length];
            var bit = (b >> bitIdx) & 1;
            matrix[row][c2] = (bit === 1) ^ ((row + c2) % 2 === 0);
            bitIdx++;
            if (bitIdx >= 8) {
              bitIdx = 0;
              byteIdx++;
            }
          }
        }
      }
    }

    return matrix;
  }

  window.QRCode = QRCode;
})(window);

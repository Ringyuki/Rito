(function () {
  'use strict';
  function traceRoundedRect(ctx, x, y, width, height, radiusX, radiusY = radiusX) {
    const rx = Math.min(radiusX, width / 2);
    const ry = Math.min(radiusY, height / 2);
    ctx.beginPath();
    if (rx === ry) traceCircularRoundedRect(ctx, x, y, width, height, rx);
    else traceEllipticalRoundedRect(ctx, x, y, width, height, rx, ry);
    ctx.closePath();
  }
  function traceCornerRoundedRect(ctx, x, y, width, height, corners) {
    const [tl, tr, br, bl] = scaleCornerOverlap(corners, width, height);
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.arcTo(x + width, y, x + width, y + height, tr);
    ctx.arcTo(x + width, y + height, x, y + height, br);
    ctx.arcTo(x, y + height, x, y, bl);
    ctx.arcTo(x, y, x + width, y, tl);
    ctx.closePath();
  }
  function scaleCornerOverlap(corners, width, height) {
    const tl = Math.max(0, corners[0]);
    const tr = Math.max(0, corners[1]);
    const br = Math.max(0, corners[2]);
    const bl = Math.max(0, corners[3]);
    const factor = Math.min(
      1,
      width / Math.max(1e-6, tl + tr),
      width / Math.max(1e-6, bl + br),
      height / Math.max(1e-6, tl + bl),
      height / Math.max(1e-6, tr + br),
    );
    return [tl * factor, tr * factor, br * factor, bl * factor];
  }
  function traceBoxPathCCW(ctx, x, y, width, height, radiusX, radiusY = radiusX) {
    const rx = Math.min(radiusX, width / 2);
    const ry = Math.min(radiusY, height / 2);
    if (rx <= 0 && ry <= 0) {
      traceRectCCW(ctx, x, y, width, height);
      return;
    }
    if (rx === ry) {
      traceCircularRoundedRectCCW(ctx, x, y, width, height, rx);
      return;
    }
    traceEllipticalRoundedRectCCW(ctx, x, y, width, height, rx, ry);
  }
  function traceCircularRoundedRect(ctx, x, y, width, height, radius) {
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
  }
  function traceEllipticalRoundedRect(ctx, x, y, width, height, radiusX, radiusY) {
    const pi = Math.PI;
    ctx.moveTo(x + radiusX, y);
    ctx.lineTo(x + width - radiusX, y);
    ctx.ellipse(x + width - radiusX, y + radiusY, radiusX, radiusY, 0, -pi / 2, 0);
    ctx.lineTo(x + width, y + height - radiusY);
    ctx.ellipse(x + width - radiusX, y + height - radiusY, radiusX, radiusY, 0, 0, pi / 2);
    ctx.lineTo(x + radiusX, y + height);
    ctx.ellipse(x + radiusX, y + height - radiusY, radiusX, radiusY, 0, pi / 2, pi);
    ctx.lineTo(x, y + radiusY);
    ctx.ellipse(x + radiusX, y + radiusY, radiusX, radiusY, 0, pi, pi * 1.5);
  }
  function traceRectCCW(ctx, x, y, width, height) {
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + height);
    ctx.lineTo(x + width, y + height);
    ctx.lineTo(x + width, y);
    ctx.closePath();
  }
  function traceCircularRoundedRectCCW(ctx, x, y, width, height, radius) {
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x, y, x, y + height, radius);
    ctx.arcTo(x, y + height, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x + width, y, radius);
    ctx.arcTo(x + width, y, x, y, radius);
    ctx.closePath();
  }
  function traceEllipticalRoundedRectCCW(ctx, x, y, width, height, radiusX, radiusY) {
    const pi = Math.PI;
    ctx.moveTo(x + radiusX, y);
    ctx.ellipse(x + radiusX, y + radiusY, radiusX, radiusY, 0, -pi / 2, pi, true);
    ctx.lineTo(x, y + height - radiusY);
    ctx.ellipse(x + radiusX, y + height - radiusY, radiusX, radiusY, 0, pi, pi / 2, true);
    ctx.lineTo(x + width - radiusX, y + height);
    ctx.ellipse(x + width - radiusX, y + height - radiusY, radiusX, radiusY, 0, pi / 2, 0, true);
    ctx.lineTo(x + width, y + radiusY);
    ctx.ellipse(x + width - radiusX, y + radiusY, radiusX, radiusY, 0, 0, -pi / 2, true);
    ctx.closePath();
  }
  const DEFAULT_POS_AUTO = {
    x: { unit: 'percent', value: 0 },
    y: { unit: 'percent', value: 0 },
  };
  const DEFAULT_POS_CENTER = {
    x: { unit: 'percent', value: 50 },
    y: { unit: 'percent', value: 50 },
  };
  function renderBackgroundImage(ctx, rect, background, rx, ry, imageResolver, corners) {
    if (!background.image) return;
    const bitmap = resolveCanvasImage(imageResolver, background.image);
    if (!bitmap) return;
    const boxW = rect.width;
    const boxH = rect.height;
    const image = resolveImageGeometry(bitmap, background, rect.x, rect.y, boxW, boxH);
    ctx.save();
    try {
      clipBackgroundBox(ctx, rect.x, rect.y, boxW, boxH, rx, ry, corners);
      if (background.repeat !== 'no-repeat' && image.drawW > 0 && image.drawH > 0) {
        drawRepeatedImage(ctx, image, rect.x, rect.y, boxW, boxH);
      } else {
        ctx.drawImage(bitmap, image.drawX, image.drawY, image.drawW, image.drawH);
      }
    } finally {
      ctx.restore();
    }
  }
  function resolveCanvasImage(imageResolver, src) {
    return imageResolver(src);
  }
  function resolveImageGeometry(bitmap, background, blockX, blockY, boxW, boxH) {
    const size = background.size ?? 'auto';
    const { drawW, drawH } = resolveImageSize(size, bitmap.width, bitmap.height, boxW, boxH);
    const position =
      background.position ?? (size === 'auto' ? DEFAULT_POS_AUTO : DEFAULT_POS_CENTER);
    return {
      bitmap,
      drawX: blockX + resolvePositionAxis(position.x, boxW, drawW),
      drawY: blockY + resolvePositionAxis(position.y, boxH, drawH),
      drawW,
      drawH,
    };
  }
  function resolveImageSize(size, imageWidth, imageHeight, boxWidth, boxHeight) {
    if (size === 'cover') {
      const scale = Math.max(boxWidth / imageWidth, boxHeight / imageHeight);
      return { drawW: imageWidth * scale, drawH: imageHeight * scale };
    }
    if (size === 'contain') {
      const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
      return { drawW: imageWidth * scale, drawH: imageHeight * scale };
    }
    if (typeof size === 'object') {
      const axis = (value, containerSize) => {
        if (value === 'auto') return void 0;
        return value.unit === 'percent' ? (containerSize * value.value) / 100 : value.value;
      };
      const explicitW = axis(size.x, boxWidth);
      const explicitH = axis(size.y, boxHeight);
      const drawW =
        explicitW ?? (explicitH !== void 0 ? (explicitH * imageWidth) / imageHeight : imageWidth);
      const drawH =
        explicitH ?? (explicitW !== void 0 ? (explicitW * imageHeight) / imageWidth : imageHeight);
      return { drawW, drawH };
    }
    return { drawW: imageWidth, drawH: imageHeight };
  }
  function clipBackgroundBox(ctx, x, y, width, height, radiusX, radiusY, corners) {
    if (corners) {
      traceCornerRoundedRect(ctx, x, y, width, height, corners);
    } else if (radiusX > 0 || radiusY > 0) {
      traceRoundedRect(ctx, x, y, width, height, radiusX, radiusY);
    } else {
      ctx.beginPath();
      ctx.rect(x, y, width, height);
    }
    ctx.clip();
  }
  function drawRepeatedImage(ctx, image, blockX, blockY, boxWidth, boxHeight) {
    const startX = image.drawX - Math.ceil((image.drawX - blockX) / image.drawW) * image.drawW;
    const startY = image.drawY - Math.ceil((image.drawY - blockY) / image.drawH) * image.drawH;
    for (let y = startY; y < blockY + boxHeight; y += image.drawH) {
      for (let x = startX; x < blockX + boxWidth; x += image.drawW) {
        ctx.drawImage(image.bitmap, x, y, image.drawW, image.drawH);
      }
    }
  }
  function resolvePositionAxis(value, containerSize, imageSize) {
    if (value.unit === 'percent') return ((containerSize - imageSize) * value.value) / 100;
    return value.value;
  }
  const ZERO_EDGE = { width: 0, color: '#000', style: 'solid' };
  function toRenderBorders(borderBox, paint) {
    if (!borderBox && !paint) return void 0;
    return {
      top: toRenderBorderEdge(
        borderBox == null ? void 0 : borderBox.topWidth,
        paint == null ? void 0 : paint.top,
      ),
      right: toRenderBorderEdge(
        borderBox == null ? void 0 : borderBox.rightWidth,
        paint == null ? void 0 : paint.right,
      ),
      bottom: toRenderBorderEdge(
        borderBox == null ? void 0 : borderBox.bottomWidth,
        paint == null ? void 0 : paint.bottom,
      ),
      left: toRenderBorderEdge(
        borderBox == null ? void 0 : borderBox.leftWidth,
        paint == null ? void 0 : paint.left,
      ),
    };
  }
  function hasVisibleBorder({ top, right, bottom, left }) {
    return top.width > 0 || right.width > 0 || bottom.width > 0 || left.width > 0;
  }
  function bordersAreUniform({ top, right, bottom, left }) {
    return (
      top.width === right.width &&
      right.width === bottom.width &&
      bottom.width === left.width &&
      top.color === right.color &&
      right.color === bottom.color &&
      bottom.color === left.color &&
      top.style === right.style &&
      right.style === bottom.style &&
      bottom.style === left.style
    );
  }
  function resolveRoundedBorderGeometry(borders, x, y, width, height, radiusX, radiusY) {
    const { top, right, bottom, left } = borders;
    const cornerRadiusX = Math.min(radiusX, width / 2);
    const cornerRadiusY = Math.min(radiusY, height / 2);
    const maxBorder = Math.max(top.width, right.width, bottom.width, left.width);
    return {
      x,
      y,
      width,
      height,
      cornerRadiusX,
      cornerRadiusY,
      innerX: x + left.width,
      innerY: y + top.width,
      innerWidth: width - left.width - right.width,
      innerHeight: height - top.width - bottom.width,
      innerRadiusX: Math.max(0, cornerRadiusX - maxBorder),
      innerRadiusY: Math.max(0, cornerRadiusY - maxBorder),
      centerX: x + width / 2,
      centerY: y + height / 2,
    };
  }
  function getBorderSides(borders, geometry) {
    const { top, right, bottom, left } = borders;
    const { x, y, width, height } = geometry;
    return [
      [top, x, y, x + width, y],
      [right, x + width, y, x + width, y + height],
      [bottom, x + width, y + height, x, y + height],
      [left, x, y + height, x, y],
    ];
  }
  function toRenderBorderEdge(width, paint) {
    if (width === void 0 || width <= 0 || !paint) return ZERO_EDGE;
    return { width, color: paint.color, style: paint.style };
  }
  function strokeBorder(ctx, edge, x1, y1, x2, y2) {
    if (edge.style === 'dotted' && edge.width === 1) {
      strokeHairlineDotted(ctx, edge, x1, y1, x2, y2);
      return;
    }
    applyStrokeStyle(ctx, edge);
    const snap = edge.width % 2 === 1 ? 0.5 : 0;
    ctx.beginPath();
    ctx.moveTo(Math.round(x1) + snap, Math.round(y1) + snap);
    ctx.lineTo(Math.round(x2) + snap, Math.round(y2) + snap);
    ctx.stroke();
  }
  function strokeHairlineDotted(ctx, edge, x1, y1, x2, y2) {
    ctx.fillStyle = edge.color;
    const horizontal = y1 === y2;
    const start = Math.round(horizontal ? x1 : y1);
    const end = Math.round(horizontal ? x2 : y2);
    const row = Math.round((horizontal ? y1 : x1) - 0.5);
    const span = end - start;
    const dot = (offset) => {
      if (horizontal) {
        ctx.fillRect(start + offset, row, 1, 1);
      } else {
        ctx.fillRect(row, start + offset, 1, 1);
      }
    };
    let from = 0;
    if (span > 1 && span % 2 === 0) {
      dot(0);
      dot(1);
      from = 3;
    }
    for (let offset = from; offset < span; offset += 2) {
      dot(offset);
    }
  }
  function applyStrokeStyle(ctx, edge) {
    ctx.strokeStyle = edge.color;
    if (edge.style === 'dotted') {
      const dotWidth = edge.width * 0.75;
      ctx.lineWidth = dotWidth;
      ctx.setLineDash([1e-3, edge.width * 1.5]);
      ctx.lineCap = 'round';
      return;
    }
    ctx.lineWidth = edge.width;
    ctx.setLineDash(dashPattern(edge.style, edge.width));
    ctx.lineCap = 'butt';
  }
  function dashPattern(style, width) {
    if (style === 'dotted') return [1e-3, width * 1.5];
    if (style === 'dashed') return [width * 3, width * 2];
    return [];
  }
  function renderBlockBorders(ctx, borderBox, paint, x, y, width, height, radiusX, radiusY) {
    const borders = toRenderBorders(borderBox, paint);
    if (!borders) return;
    if (radiusX > 0 || radiusY > 0) {
      renderRoundedBorders(ctx, borders, x, y, width, height, radiusX, radiusY);
      return;
    }
    renderStraightBorders(ctx, borders, x, y, width, height);
  }
  function renderStraightBorders(ctx, borders, x, y, width, height) {
    const { top, right, bottom, left } = borders;
    ctx.save();
    try {
      if (top.width > 0) {
        strokeBorder(ctx, top, x, y + top.width / 2, x + width, y + top.width / 2);
      }
      if (bottom.width > 0) {
        strokeBorder(
          ctx,
          bottom,
          x,
          y + height - bottom.width / 2,
          x + width,
          y + height - bottom.width / 2,
        );
      }
      if (left.width > 0) {
        strokeBorder(ctx, left, x + left.width / 2, y, x + left.width / 2, y + height);
      }
      if (right.width > 0) {
        strokeBorder(
          ctx,
          right,
          x + width - right.width / 2,
          y,
          x + width - right.width / 2,
          y + height,
        );
      }
    } finally {
      ctx.restore();
    }
  }
  function renderRoundedBorders(ctx, borders, x, y, width, height, radiusX, radiusY) {
    if (!hasVisibleBorder(borders)) return;
    if (bordersAreUniform(borders)) {
      renderUniformRoundedBorder(ctx, borders.top, x, y, width, height, radiusX, radiusY);
      return;
    }
    const geometry = resolveRoundedBorderGeometry(borders, x, y, width, height, radiusX, radiusY);
    for (const side of getBorderSides(borders, geometry)) {
      renderRoundedBorderSide(ctx, side, geometry);
    }
  }
  function renderUniformRoundedBorder(ctx, edge, x, y, width, height, radiusX, radiusY) {
    ctx.save();
    try {
      applyStrokeStyle(ctx, edge);
      traceRoundedRect(ctx, x, y, width, height, radiusX, radiusY);
      ctx.stroke();
    } finally {
      ctx.restore();
    }
  }
  function renderRoundedBorderSide(ctx, side, geometry) {
    const [edge] = side;
    if (edge.width <= 0) return;
    ctx.save();
    try {
      clipBorderSide(ctx, side, geometry);
      if (edge.style !== 'solid') drawStyledRoundedStroke(ctx, edge, geometry);
      else fillSolidRoundedSide(ctx, edge, geometry);
    } finally {
      ctx.restore();
    }
  }
  function clipBorderSide(ctx, [, x1, y1, x2, y2], geometry) {
    ctx.beginPath();
    ctx.moveTo(geometry.centerX, geometry.centerY);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.clip();
  }
  function drawStyledRoundedStroke(ctx, edge, geometry) {
    applyStrokeStyle(ctx, edge);
    traceRoundedRect(
      ctx,
      geometry.x,
      geometry.y,
      geometry.width,
      geometry.height,
      geometry.cornerRadiusX,
      geometry.cornerRadiusY,
    );
    ctx.stroke();
  }
  function fillSolidRoundedSide(ctx, edge, geometry) {
    ctx.fillStyle = edge.color;
    ctx.beginPath();
    traceRoundedRect(
      ctx,
      geometry.x,
      geometry.y,
      geometry.width,
      geometry.height,
      geometry.cornerRadiusX,
      geometry.cornerRadiusY,
    );
    if (geometry.innerWidth > 0 && geometry.innerHeight > 0) {
      traceBoxPathCCW(
        ctx,
        geometry.innerX,
        geometry.innerY,
        geometry.innerWidth,
        geometry.innerHeight,
        geometry.innerRadiusX,
        geometry.innerRadiusY,
      );
    }
    ctx.fill('evenodd');
  }
  function renderBoxShadows(ctx, shadows, x, y, width, height, radiusX, radiusY = radiusX) {
    for (let index = shadows.length - 1; index >= 0; index -= 1) {
      const shadow = shadows[index];
      if (!shadow || shadow.inset) continue;
      renderSingleBoxShadow(ctx, shadow, x, y, width, height, radiusX, radiusY);
    }
  }
  function renderSingleBoxShadow(ctx, shadow, x, y, width, height, radiusX, radiusY) {
    ctx.save();
    try {
      clipOutsideBox(ctx, shadow, x, y, width, height, radiusX, radiusY);
      applyCanvasShadow(ctx, shadow);
      fillExpandedShadowShape(ctx, shadow, x, y, width, height, radiusX, radiusY);
    } finally {
      ctx.restore();
    }
  }
  function clipOutsideBox(ctx, shadow, x, y, width, height, radiusX, radiusY) {
    const padding =
      shadow.blur * 2 +
      Math.abs(shadow.offsetX) +
      Math.abs(shadow.offsetY) +
      Math.max(shadow.spread, 0) +
      50;
    ctx.beginPath();
    ctx.rect(x - padding, y - padding, width + padding * 2, height + padding * 2);
    traceBoxPathCCW(ctx, x, y, width, height, radiusX, radiusY);
    ctx.clip('evenodd');
  }
  function applyCanvasShadow(ctx, shadow) {
    const pixelRatio = ctx.getTransform().a || 1;
    ctx.shadowColor = shadow.color;
    ctx.shadowBlur = shadow.blur * pixelRatio;
    ctx.shadowOffsetX = shadow.offsetX * pixelRatio;
    ctx.shadowOffsetY = shadow.offsetY * pixelRatio;
    ctx.fillStyle = shadow.color;
  }
  function fillExpandedShadowShape(ctx, shadow, x, y, width, height, radiusX, radiusY) {
    const spread = shadow.spread;
    const expandedWidth = width + spread * 2;
    const expandedHeight = height + spread * 2;
    if (expandedWidth <= 0 || expandedHeight <= 0) return;
    const expandedRadiusX = Math.max(0, radiusX + spread);
    const expandedRadiusY = Math.max(0, radiusY + spread);
    if (expandedRadiusX > 0 || expandedRadiusY > 0) {
      traceRoundedRect(
        ctx,
        x - spread,
        y - spread,
        expandedWidth,
        expandedHeight,
        expandedRadiusX,
        expandedRadiusY,
      );
    } else {
      ctx.beginPath();
      ctx.rect(x - spread, y - spread, expandedWidth, expandedHeight);
    }
    ctx.fill();
  }
  function renderCanvasBlockDecoration(ctx, command, imageResolver) {
    const { rect, paint, borderBox } = command;
    const resolved = resolveCanvasBlockRadius(command);
    const { rx, ry } = resolved;
    const { background } = paint;
    if (paint.boxShadow && paint.boxShadow.length > 0) {
      renderBoxShadows(ctx, paint.boxShadow, rect.x, rect.y, rect.width, rect.height, rx, ry);
    }
    if (background == null ? void 0 : background.color)
      fillBackgroundColor(ctx, background.color, rect, resolved);
    if ((background == null ? void 0 : background.image) && imageResolver) {
      renderBackgroundImage(ctx, rect, background, rx, ry, imageResolver, resolved.corners);
    }
    renderBlockBorders(
      ctx,
      borderBox,
      paint.border,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      rx,
      ry,
    );
  }
  function resolveCanvasBlockRadius(command) {
    const { radius } = command.paint;
    if ((radius == null ? void 0 : radius.corners) !== void 0) {
      return { rx: 0, ry: 0, corners: radius.corners };
    }
    if ((radius == null ? void 0 : radius.pct) !== void 0) {
      const ratio = radius.pct / 100;
      return { rx: ratio * command.rect.width, ry: ratio * command.rect.height };
    }
    const pixels = (radius == null ? void 0 : radius.px) ?? 0;
    return { rx: pixels, ry: pixels };
  }
  function fillBackgroundColor(ctx, color, rect, { rx, ry, corners }) {
    ctx.fillStyle = color;
    if (corners) {
      traceCornerRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, corners);
      ctx.fill();
      return;
    }
    if (rx > 0 || ry > 0) {
      traceRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, rx, ry);
      ctx.fill();
      return;
    }
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
  function buildFontString(font) {
    const parts = [];
    if (font.style === 'italic') parts.push('italic');
    if (font.weight !== 400) parts.push(String(font.weight));
    parts.push(`${String(font.sizePx)}px`);
    parts.push(font.family);
    return parts.join(' ');
  }
  function computeInlineBoxRect({ rect, paint }, ctx) {
    var _a, _b, _c, _d;
    const padding = paint.padding;
    const border = paint.border;
    const paddingLeft = (padding == null ? void 0 : padding.left) ?? 0;
    const paddingRight = (padding == null ? void 0 : padding.right) ?? 0;
    const paddingTop = (padding == null ? void 0 : padding.top) ?? 0;
    const paddingBottom = (padding == null ? void 0 : padding.bottom) ?? 0;
    const borderLeft =
      ((_a = border == null ? void 0 : border.start) == null ? void 0 : _a.widthPx) ?? 0;
    const borderRight =
      ((_b = border == null ? void 0 : border.end) == null ? void 0 : _b.widthPx) ?? 0;
    const borderTop =
      ((_c = border == null ? void 0 : border.top) == null ? void 0 : _c.widthPx) ?? 0;
    const borderBottom =
      ((_d = border == null ? void 0 : border.bottom) == null ? void 0 : _d.widthPx) ?? 0;
    const size = paint.font.sizePx;
    let contentTop = rect.y;
    let contentHeight = size;
    const metrics = ctx == null ? void 0 : ctx.measureText('x');
    if (
      metrics &&
      Number.isFinite(metrics.fontBoundingBoxAscent) &&
      Number.isFinite(metrics.fontBoundingBoxDescent)
    ) {
      contentTop = rect.y + 0.8 * size - metrics.fontBoundingBoxAscent;
      contentHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
    }
    return {
      x: rect.x - paddingLeft - borderLeft,
      y: contentTop - paddingTop - borderTop,
      width: rect.width + paddingLeft + paddingRight + borderLeft + borderRight,
      height: contentHeight + paddingTop + paddingBottom + borderTop + borderBottom,
    };
  }
  function traceInlineRoundedRect(ctx, { x, y, width, height }, radius) {
    const resolvedRadius = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + resolvedRadius, y);
    ctx.arcTo(x + width, y, x + width, y + height, resolvedRadius);
    ctx.arcTo(x + width, y + height, x, y + height, resolvedRadius);
    ctx.arcTo(x, y + height, x, y, resolvedRadius);
    ctx.arcTo(x, y, x + width, y, resolvedRadius);
    ctx.closePath();
  }
  function drawInlineBackground(ctx, fragment) {
    const color = fragment.paint.backgroundColor;
    if (!color) return;
    const rect = computeInlineBoxRect(fragment, ctx);
    const radius = fragment.paint.backgroundRadius ?? 0;
    ctx.save();
    try {
      ctx.fillStyle = color;
      if (radius > 0) {
        traceInlineRoundedRect(ctx, rect, radius);
        ctx.fill();
      } else {
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      }
    } finally {
      ctx.restore();
    }
  }
  function drawInlineBorders(ctx, fragment) {
    const border = fragment.paint.border;
    if (!border) return;
    const { top, bottom, start, end } = border;
    if (!top && !bottom && !start && !end) return;
    const rect = computeInlineBoxRect(fragment, ctx);
    const radius = fragment.paint.backgroundRadius ?? 0;
    ctx.save();
    try {
      if (top && bottom && start && end && radius > 0) {
        drawRoundedInlineBorders(ctx, rect, radius, getRoundedSides(rect, top, end, bottom, start));
      } else {
        drawStraightInlineBorders(ctx, rect, top, bottom, start, end);
      }
    } finally {
      ctx.restore();
    }
  }
  function drawRoundedInlineBorders(ctx, rect, radius, sides) {
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    for (const side of sides) {
      drawRoundedInlineSide(ctx, side, rect, radius, centerX, centerY);
    }
  }
  function getRoundedSides(rect, top, end, bottom, start) {
    return [
      [top, rect.x, rect.y, rect.x + rect.width, rect.y],
      [end, rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height],
      [bottom, rect.x + rect.width, rect.y + rect.height, rect.x, rect.y + rect.height],
      [start, rect.x, rect.y + rect.height, rect.x, rect.y],
    ];
  }
  function drawRoundedInlineSide(ctx, [edge, x1, y1, x2, y2], rect, radius, centerX, centerY) {
    ctx.save();
    try {
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.clip();
      ctx.strokeStyle = edge.paint.color;
      ctx.lineWidth = edge.widthPx;
      ctx.setLineDash([]);
      traceInlineRoundedRect(ctx, rect, radius);
      ctx.stroke();
    } finally {
      ctx.restore();
    }
  }
  function drawStraightInlineBorders(ctx, rect, top, bottom, start, end) {
    if (top) drawTopBorder(ctx, rect, top);
    if (bottom) drawBottomBorder(ctx, rect, bottom);
    if (start) drawStartBorder(ctx, rect, start);
    if (end) drawEndBorder(ctx, rect, end);
  }
  function drawTopBorder(ctx, rect, edge) {
    drawBorderEdge(
      ctx,
      edge,
      rect.x,
      rect.y + edge.widthPx / 2,
      rect.x + rect.width,
      rect.y + edge.widthPx / 2,
    );
  }
  function drawBottomBorder(ctx, rect, edge) {
    drawBorderEdge(
      ctx,
      edge,
      rect.x,
      rect.y + rect.height - edge.widthPx / 2,
      rect.x + rect.width,
      rect.y + rect.height - edge.widthPx / 2,
    );
  }
  function drawStartBorder(ctx, rect, edge) {
    drawBorderEdge(
      ctx,
      edge,
      rect.x + edge.widthPx / 2,
      rect.y,
      rect.x + edge.widthPx / 2,
      rect.y + rect.height,
    );
  }
  function drawEndBorder(ctx, rect, edge) {
    drawBorderEdge(
      ctx,
      edge,
      rect.x + rect.width - edge.widthPx / 2,
      rect.y,
      rect.x + rect.width - edge.widthPx / 2,
      rect.y + rect.height,
    );
  }
  function drawBorderEdge(ctx, edge, x1, y1, x2, y2) {
    ctx.strokeStyle = edge.paint.color;
    ctx.lineWidth = edge.widthPx;
    applyLineDash(ctx, edge);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  function applyLineDash(ctx, edge) {
    if (edge.paint.style === 'dotted') {
      ctx.setLineDash([1e-3, edge.widthPx * 1.5]);
      ctx.lineCap = 'round';
    } else if (edge.paint.style === 'dashed') {
      ctx.setLineDash([edge.widthPx * 3, edge.widthPx * 2]);
      ctx.lineCap = 'butt';
    } else {
      ctx.setLineDash([]);
      ctx.lineCap = 'butt';
    }
  }
  function canvasSpacingValue(value) {
    return value === void 0 ? '0px' : `${String(value)}px`;
  }
  function drawTextShadows(ctx, fragment, x, y, color) {
    const shadows = fragment.paint.textShadow ?? [];
    if (shadows.length === 0) return;
    const { padLeft, padRight, padTop, padBottom } = computeShadowPadding(shadows);
    const logicalWidth = fragment.rect.width + padLeft + padRight;
    const logicalHeight = fragment.rect.height + padTop + padBottom;
    if (logicalWidth <= 0 || logicalHeight <= 0) return;
    const pixelRatio = ctx.getTransform().a || 1;
    const physicalWidth = Math.ceil(logicalWidth * pixelRatio);
    const physicalHeight = Math.ceil(logicalHeight * pixelRatio);
    const scratch = createScratchCanvas(physicalWidth, physicalHeight);
    if (!scratch) return;
    scratch.ctx.scale(pixelRatio, pixelRatio);
    syncTextState(scratch.ctx, ctx, fragment, color);
    renderShadowLayers(scratch.ctx, shadows, fragment.text, padLeft, padTop, pixelRatio);
    eraseTextGlyph(scratch.ctx, fragment.text, padLeft, padTop);
    ctx.drawImage(
      scratch.canvas,
      0,
      0,
      physicalWidth,
      physicalHeight,
      x - padLeft,
      y - padTop,
      logicalWidth,
      logicalHeight,
    );
  }
  function renderShadowLayers(ctx, shadows, text, x, y, pixelRatio) {
    for (let index = shadows.length - 1; index >= 0; index -= 1) {
      const shadow = shadows[index];
      if (!shadow) continue;
      ctx.shadowColor = shadow.color;
      ctx.shadowBlur = shadow.blur * pixelRatio;
      ctx.shadowOffsetX = shadow.offsetX * pixelRatio;
      ctx.shadowOffsetY = shadow.offsetY * pixelRatio;
      ctx.fillText(text, x, y);
    }
  }
  function eraseTextGlyph(ctx, text, x, y) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalCompositeOperation = 'destination-out';
    try {
      ctx.fillText(text, x, y);
    } finally {
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  function computeShadowPadding(shadows) {
    let padLeft = 0;
    let padRight = 0;
    let padTop = 0;
    let padBottom = 0;
    for (const shadow of shadows) {
      const doubleBlur = shadow.blur * 2;
      padLeft = Math.max(padLeft, doubleBlur + Math.max(0, -shadow.offsetX));
      padRight = Math.max(padRight, doubleBlur + Math.max(0, shadow.offsetX));
      padTop = Math.max(padTop, doubleBlur + Math.max(0, -shadow.offsetY));
      padBottom = Math.max(padBottom, doubleBlur + Math.max(0, shadow.offsetY));
    }
    return { padLeft, padRight, padTop, padBottom };
  }
  function createScratchCanvas(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      return ctx ? { canvas, ctx } : null;
    }
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      return ctx ? { canvas, ctx } : null;
    }
    return null;
  }
  function syncTextState(destination, source, fragment, color) {
    destination.font = source.font;
    destination.textBaseline = 'top';
    destination.fillStyle = color;
    destination.wordSpacing = canvasSpacingValue(fragment.paint.wordSpacingPx);
    destination.letterSpacing = canvasSpacingValue(fragment.paint.letterSpacingPx);
  }
  const CSS_NAMED_COLORS = {
    aliceblue: [240, 248, 255],
    antiquewhite: [250, 235, 215],
    aqua: [0, 255, 255],
    aquamarine: [127, 255, 212],
    azure: [240, 255, 255],
    beige: [245, 245, 220],
    bisque: [255, 228, 196],
    black: [0, 0, 0],
    blanchedalmond: [255, 235, 205],
    blue: [0, 0, 255],
    blueviolet: [138, 43, 226],
    brown: [165, 42, 42],
    burlywood: [222, 184, 135],
    cadetblue: [95, 158, 160],
    chartreuse: [127, 255, 0],
    chocolate: [210, 105, 30],
    coral: [255, 127, 80],
    cornflowerblue: [100, 149, 237],
    cornsilk: [255, 248, 220],
    crimson: [220, 20, 60],
    cyan: [0, 255, 255],
    darkblue: [0, 0, 139],
    darkcyan: [0, 139, 139],
    darkgoldenrod: [184, 134, 11],
    darkgray: [169, 169, 169],
    darkgreen: [0, 100, 0],
    darkgrey: [169, 169, 169],
    darkkhaki: [189, 183, 107],
    darkmagenta: [139, 0, 139],
    darkolivegreen: [85, 107, 47],
    darkorange: [255, 140, 0],
    darkorchid: [153, 50, 204],
    darkred: [139, 0, 0],
    darksalmon: [233, 150, 122],
    darkseagreen: [143, 188, 143],
    darkslateblue: [72, 61, 139],
    darkslategray: [47, 79, 79],
    darkslategrey: [47, 79, 79],
    darkturquoise: [0, 206, 209],
    darkviolet: [148, 0, 211],
    deeppink: [255, 20, 147],
    deepskyblue: [0, 191, 255],
    dimgray: [105, 105, 105],
    dimgrey: [105, 105, 105],
    dodgerblue: [30, 144, 255],
    firebrick: [178, 34, 34],
    floralwhite: [255, 250, 240],
    forestgreen: [34, 139, 34],
    fuchsia: [255, 0, 255],
    gainsboro: [220, 220, 220],
    ghostwhite: [248, 248, 255],
    gold: [255, 215, 0],
    goldenrod: [218, 165, 32],
    gray: [128, 128, 128],
    green: [0, 128, 0],
    greenyellow: [173, 255, 47],
    grey: [128, 128, 128],
    honeydew: [240, 255, 240],
    hotpink: [255, 105, 180],
    indianred: [205, 92, 92],
    indigo: [75, 0, 130],
    ivory: [255, 255, 240],
    khaki: [240, 230, 140],
    lavender: [230, 230, 250],
    lavenderblush: [255, 240, 245],
    lawngreen: [124, 252, 0],
    lemonchiffon: [255, 250, 205],
    lightblue: [173, 216, 230],
    lightcoral: [240, 128, 128],
    lightcyan: [224, 255, 255],
    lightgoldenrodyellow: [250, 250, 210],
    lightgray: [211, 211, 211],
    lightgreen: [144, 238, 144],
    lightgrey: [211, 211, 211],
    lightpink: [255, 182, 193],
    lightsalmon: [255, 160, 122],
    lightseagreen: [32, 178, 170],
    lightskyblue: [135, 206, 250],
    lightslategray: [119, 136, 153],
    lightslategrey: [119, 136, 153],
    lightsteelblue: [176, 196, 222],
    lightyellow: [255, 255, 224],
    lime: [0, 255, 0],
    limegreen: [50, 205, 50],
    linen: [250, 240, 230],
    magenta: [255, 0, 255],
    maroon: [128, 0, 0],
    mediumaquamarine: [102, 205, 170],
    mediumblue: [0, 0, 205],
    mediumorchid: [186, 85, 211],
    mediumpurple: [147, 112, 219],
    mediumseagreen: [60, 179, 113],
    mediumslateblue: [123, 104, 238],
    mediumspringgreen: [0, 250, 154],
    mediumturquoise: [72, 209, 204],
    mediumvioletred: [199, 21, 133],
    midnightblue: [25, 25, 112],
    mintcream: [245, 255, 250],
    mistyrose: [255, 228, 225],
    moccasin: [255, 228, 181],
    navajowhite: [255, 222, 173],
    navy: [0, 0, 128],
    oldlace: [253, 245, 230],
    olive: [128, 128, 0],
    olivedrab: [107, 142, 35],
    orange: [255, 165, 0],
    orangered: [255, 69, 0],
    orchid: [218, 112, 214],
    palegoldenrod: [238, 232, 170],
    palegreen: [152, 251, 152],
    paleturquoise: [175, 238, 238],
    palevioletred: [219, 112, 147],
    papayawhip: [255, 239, 213],
    peachpuff: [255, 218, 185],
    peru: [205, 133, 63],
    pink: [255, 192, 203],
    plum: [221, 160, 221],
    powderblue: [176, 224, 230],
    purple: [128, 0, 128],
    rebeccapurple: [102, 51, 153],
    red: [255, 0, 0],
    rosybrown: [188, 143, 143],
    royalblue: [65, 105, 225],
    saddlebrown: [139, 69, 19],
    salmon: [250, 128, 114],
    sandybrown: [244, 164, 96],
    seagreen: [46, 139, 87],
    seashell: [255, 245, 238],
    sienna: [160, 82, 45],
    silver: [192, 192, 192],
    skyblue: [135, 206, 235],
    slateblue: [106, 90, 205],
    slategray: [112, 128, 144],
    slategrey: [112, 128, 144],
    snow: [255, 250, 250],
    springgreen: [0, 255, 127],
    steelblue: [70, 130, 180],
    tan: [210, 180, 140],
    teal: [0, 128, 128],
    thistle: [216, 191, 216],
    tomato: [255, 99, 71],
    turquoise: [64, 224, 208],
    violet: [238, 130, 238],
    wheat: [245, 222, 179],
    white: [255, 255, 255],
    whitesmoke: [245, 245, 245],
    yellow: [255, 255, 0],
    yellowgreen: [154, 205, 50],
  };
  function hslToRgb(h, s, l) {
    const hue = ((h % 360) + 360) % 360;
    const sat = Math.max(0, Math.min(1, s / 100));
    const lit = Math.max(0, Math.min(1, l / 100));
    const chroma = (1 - Math.abs(2 * lit - 1)) * sat;
    const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const match = lit - chroma / 2;
    let red;
    let green;
    let blue;
    if (hue < 60) {
      [red, green, blue] = [chroma, second, 0];
    } else if (hue < 120) {
      [red, green, blue] = [second, chroma, 0];
    } else if (hue < 180) {
      [red, green, blue] = [0, chroma, second];
    } else if (hue < 240) {
      [red, green, blue] = [0, second, chroma];
    } else if (hue < 300) {
      [red, green, blue] = [second, 0, chroma];
    } else {
      [red, green, blue] = [chroma, 0, second];
    }
    return [
      Math.round((red + match) * 255),
      Math.round((green + match) * 255),
      Math.round((blue + match) * 255),
    ];
  }
  function parseFunctionArgs(args) {
    const trimmed = args.trim();
    if (trimmed.length === 0) return void 0;
    if (trimmed.includes(',')) {
      const parts2 = trimmed.split(',').map((part) => part.trim().replace('%', ''));
      const numbers2 = parts2.map(Number);
      if (numbers2.some(isNaN)) return void 0;
      return numbers2;
    }
    const withoutSlash = trimmed.replace(/\s*\/\s*[\d.]+\s*$/, '');
    const parts = withoutSlash.split(/\s+/).map((part) => part.trim().replace('%', ''));
    const numbers = parts.map(Number);
    if (numbers.some(isNaN)) return void 0;
    return numbers;
  }
  function parseHex(hex) {
    if (hex.length === 4) {
      const first = hex.charAt(1);
      const second = hex.charAt(2);
      const third = hex.charAt(3);
      const red = Number.parseInt(first + first, 16);
      const green = Number.parseInt(second + second, 16);
      const blue = Number.parseInt(third + third, 16);
      if (!isNaN(red) && !isNaN(green) && !isNaN(blue)) return [red, green, blue];
    }
    if (hex.length === 7) {
      const red = Number.parseInt(hex.slice(1, 3), 16);
      const green = Number.parseInt(hex.slice(3, 5), 16);
      const blue = Number.parseInt(hex.slice(5, 7), 16);
      if (!isNaN(red) && !isNaN(green) && !isNaN(blue)) return [red, green, blue];
    }
    return void 0;
  }
  function parseRgbFunction(argsString) {
    const args = parseFunctionArgs(argsString);
    if (!args || args.length < 3) return void 0;
    const red = args[0];
    const green = args[1];
    const blue = args[2];
    if (red < 0 || red > 255 || green < 0 || green > 255 || blue < 0 || blue > 255) {
      return void 0;
    }
    return [Math.round(red), Math.round(green), Math.round(blue)];
  }
  function parseColor(color) {
    const trimmed = color.trim();
    if (trimmed.length === 0) return void 0;
    if (trimmed.startsWith('#')) return parseHex(trimmed);
    const rgbMatch = /^rgba?\(\s*(.+)\s*\)$/i.exec(trimmed);
    if (rgbMatch == null ? void 0 : rgbMatch[1]) return parseRgbFunction(rgbMatch[1]);
    const hslMatch = /^hsla?\(\s*(.+)\s*\)$/i.exec(trimmed);
    if (hslMatch == null ? void 0 : hslMatch[1]) {
      const args = parseFunctionArgs(hslMatch[1]);
      if (!args || args.length < 3) return void 0;
      return hslToRgb(args[0], args[1], args[2]);
    }
    return CSS_NAMED_COLORS[trimmed.toLowerCase()];
  }
  function relativeLuminance(red, green, blue) {
    const [rs, gs, bs] = [red / 255, green / 255, blue / 255].map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4),
    );
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }
  function contrastRatio(foreground, background) {
    const first = relativeLuminance(...foreground);
    const second = relativeLuminance(...background);
    const lighter = Math.max(first, second);
    const darker = Math.min(first, second);
    return (lighter + 0.05) / (darker + 0.05);
  }
  const WCAG_NORMAL_TEXT_THRESHOLD = 4.5;
  const WCAG_LARGE_TEXT_THRESHOLD = 3;
  function resolveTextColor(
    originalColor,
    backgroundColor,
    foregroundColor,
    minContrast,
    isLargeText = false,
  ) {
    const foreground = parseColor(originalColor);
    const background = parseColor(backgroundColor);
    if (!foreground || !background) return originalColor;
    const threshold = isLargeText ? WCAG_LARGE_TEXT_THRESHOLD : WCAG_NORMAL_TEXT_THRESHOLD;
    const ratio = contrastRatio(foreground, background);
    return ratio >= threshold ? originalColor : foregroundColor;
  }
  function drawCanvasTextFragment(ctx, fragment, colorOverride) {
    const { paint } = fragment;
    ctx.font = buildFontString(paint.font);
    const color = effectiveTextColor(paint.color, colorOverride);
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';
    ctx.wordSpacing = canvasSpacingValue(paint.wordSpacingPx);
    ctx.letterSpacing = canvasSpacingValue(paint.letterSpacingPx);
    const { x, y } = fragment.rect;
    drawInlineBackground(ctx, fragment);
    drawInlineBorders(ctx, fragment);
    if (paint.textShadow && paint.textShadow.length > 0) {
      drawTextShadows(ctx, fragment, x, y, color);
    }
    ctx.fillText(fragment.text, x, y + 0.8 * paint.font.sizePx);
    const { decoration } = paint;
    if (decoration) {
      drawLine(
        ctx,
        x,
        y + decoration.y,
        fragment.rect.width,
        decoration.color,
        decoration.thickness,
      );
    }
  }
  function drawCanvasRubyFragment(ctx, ruby, colorOverride) {
    const { paint } = ruby;
    const color = effectiveTextColor(paint.color, colorOverride);
    ctx.save();
    try {
      ctx.font = buildFontString(paint.font);
      ctx.fillStyle = color;
      ctx.textBaseline = 'top';
      ctx.wordSpacing = '0px';
      ctx.letterSpacing = '0px';
      const measured = ctx.measureText(ruby.text);
      const x = ruby.rect.x + (ruby.rect.width - measured.width) / 2;
      ctx.fillText(ruby.text, x, ruby.rect.y);
    } finally {
      ctx.restore();
    }
  }
  function effectiveTextColor(originalColor, colorOverride) {
    return colorOverride
      ? resolveTextColor(
          originalColor,
          colorOverride.backgroundColor,
          colorOverride.foregroundColor,
        )
      : originalColor;
  }
  function drawLine(ctx, x, y, width, color, thickness) {
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + width, y);
    ctx.stroke();
  }
  function renderFrameCommandsToCanvas(commands, ctx, options) {
    var _a;
    const canvasCtx = ctx;
    const state = createRenderState(options);
    const paintTap = globalThis.__ritoPaintTap;
    const onScreen =
      typeof canvasCtx.canvas.isConnected === 'boolean' ? canvasCtx.canvas.isConnected : false;
    let rendered = 0;
    canvasCtx.save();
    try {
      canvasCtx.scale(options.pixelRatio ?? 1, options.pixelRatio ?? 1);
      for (const command of commands) {
        paintTap == null ? void 0 : paintTap(command, onScreen);
        renderCommand(canvasCtx, command, state);
        rendered += 1;
      }
    } catch (error) {
      const scope = globalThis;
      scope.__ritoRenderFailures = [
        ...(scope.__ritoRenderFailures ?? []).slice(-4),
        {
          message: String(error),
          stack:
            error instanceof Error
              ? (_a = error.stack) == null
                ? void 0
                : _a.slice(0, 600)
              : void 0,
          renderedCommands: rendered,
          totalCommands: commands.length,
          failedCommand: JSON.parse(JSON.stringify(commands[rendered] ?? null)),
          at: /* @__PURE__ */ new Date().toISOString(),
        },
      ];
      throw error;
    } finally {
      while (state.commandSaveDepth > 0) {
        canvasCtx.restore();
        state.commandSaveDepth -= 1;
      }
      canvasCtx.restore();
    }
  }
  function createRenderState(options) {
    const colorOverride =
      options.foregroundColor !== void 0 && options.backgroundColor !== void 0
        ? {
            foregroundColor: options.foregroundColor,
            backgroundColor: options.backgroundColor,
          }
        : void 0;
    return {
      resolveImage: options.resolveImage ?? (() => void 0),
      commandSaveDepth: 0,
      ...(colorOverride ? { colorOverride } : {}),
    };
  }
  function renderCommand(ctx, command, state) {
    switch (command.kind) {
      case 'pushState':
        ctx.save();
        state.commandSaveDepth += 1;
        return;
      case 'popState':
        if (state.commandSaveDepth === 0) {
          throw new Error('Frame command popState has no matching pushState.');
        }
        ctx.restore();
        state.commandSaveDepth -= 1;
        return;
      case 'translate':
        ctx.translate(command.dx, command.dy);
        return;
      case 'transform':
        applyTransform(ctx, command);
        return;
      case 'opacity':
        ctx.globalAlpha = (Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1) * command.value;
        return;
      case 'clipRect':
        applyClipRect(ctx, command);
        return;
      case 'paintPage':
        paintPage(ctx, command.paint.backgroundColor, command.rect);
        return;
      case 'paintBlock':
        paintBlock(ctx, command, state);
        return;
      case 'paintText':
        paintText(ctx, command, state);
        return;
      case 'paintRuby':
        paintRuby(ctx, command, state);
        return;
      case 'paintImage':
        paintImage(ctx, command, state.resolveImage);
        return;
      case 'paintHorizontalRule':
        paintHorizontalRule(ctx, command);
        return;
      default:
        return assertNever(command);
    }
  }
  function applyClipRect(ctx, command) {
    const { rect, radius } = command;
    if (radius && (radius.rx > 0 || radius.ry > 0)) {
      traceRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, radius.rx, radius.ry);
    } else {
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.width, rect.height);
    }
    ctx.clip();
  }
  function paintPage(ctx, backgroundColor, rect) {
    if (!backgroundColor) return;
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }
  function paintBlock(ctx, command, state) {
    renderCanvasBlockDecoration(ctx, command, state.resolveImage);
  }
  function paintText(ctx, command, state) {
    drawCanvasTextFragment(
      ctx,
      { text: command.text, rect: command.rect, paint: command.paint },
      state.colorOverride,
    );
  }
  function paintRuby(ctx, command, state) {
    drawCanvasRubyFragment(
      ctx,
      { text: command.text, rect: command.rect, paint: command.paint },
      state.colorOverride,
    );
  }
  function paintImage(ctx, command, resolveImage) {
    const bitmap = resolveImage(command.src);
    if (!bitmap) return;
    const { rect, sourceRect } = command;
    if (sourceRect) {
      ctx.drawImage(
        bitmap,
        sourceRect.x,
        sourceRect.y,
        sourceRect.width,
        sourceRect.height,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
      );
      return;
    }
    ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
  }
  function paintHorizontalRule(ctx, command) {
    const { rect, paint } = command;
    const rawY = rect.y + rect.height / 2;
    const y = Math.round(rawY) + (rect.height % 2 === 1 ? 0.5 : 0);
    ctx.save();
    try {
      ctx.strokeStyle = paint.color;
      ctx.lineWidth = paint.style === 'dotted' ? rect.height * 0.75 : rect.height;
      if (paint.style === 'dotted') {
        ctx.setLineDash([1e-3, rect.height * 1.5]);
        ctx.lineCap = 'round';
      } else if (paint.style === 'dashed') {
        ctx.setLineDash([rect.height * 3, rect.height * 2]);
      }
      ctx.beginPath();
      ctx.moveTo(Math.round(rect.x), y);
      ctx.lineTo(Math.round(rect.x + rect.width), y);
      ctx.stroke();
    } finally {
      ctx.restore();
    }
  }
  function applyTransform(ctx, command) {
    const { origin, box } = command;
    ctx.translate(origin.x, origin.y);
    for (const transform of command.transforms) {
      if (transform.kind === 'rotate') ctx.rotate(transform.rad);
      else if (transform.kind === 'scale') ctx.scale(transform.sx, transform.sy);
      else {
        ctx.translate(
          resolveLengthPercentage(transform.x, box.width),
          resolveLengthPercentage(transform.y, box.height),
        );
      }
    }
    ctx.translate(-origin.x, -origin.y);
  }
  function resolveLengthPercentage(value, basis) {
    return value.unit === 'percent' ? (value.value / 100) * basis : value.value;
  }
  function assertNever(value) {
    throw new Error(`Unsupported frame command: ${JSON.stringify(value)}`);
  }
  const syntheticCache = /* @__PURE__ */ new Map();
  function makeSyntheticImage(src) {
    const cached = syntheticCache.get(src);
    if (cached) return cached;
    const pixels = syntheticPixels(src);
    if (!pixels) return void 0;
    const canvas = document.createElement('canvas');
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return void 0;
    ctx.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), 0, 0);
    syntheticCache.set(src, canvas);
    return canvas;
  }
  function syntheticPixels(src) {
    if (src === 'synthetic:checker16') {
      return fillPixels(16, 16, (x, y) =>
        ((x >> 2) + (y >> 2)) % 2 === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255],
      );
    }
    if (src === 'synthetic:gradient32') {
      return fillPixels(32, 32, (x, y) => [
        Math.floor((x * 255) / 31),
        Math.floor((y * 255) / 31),
        255 - Math.floor((x * 255) / 31),
        255,
      ]);
    }
    if (src === 'synthetic:dot8') {
      return fillPixels(8, 8, (x, y) =>
        x >= 3 && x <= 4 && y >= 3 && y <= 4 ? [0, 0, 0, 255] : [255, 255, 255, 255],
      );
    }
    return void 0;
  }
  function fillPixels(width, height, pixel) {
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const [r, g, b, a] = pixel(x, y);
        const offset = (y * width + x) * 4;
        rgba[offset] = r;
        rgba[offset + 1] = g;
        rgba[offset + 2] = b;
        rgba[offset + 3] = a;
      }
    }
    return { width, height, rgba };
  }
  function renderParityFixture(fixture) {
    const canvas = document.createElement('canvas');
    canvas.width = fixture.width;
    canvas.height = fixture.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    if (fixture.background) {
      ctx.fillStyle = fixture.background;
      ctx.fillRect(0, 0, fixture.width, fixture.height);
    }
    renderFrameCommandsToCanvas(fixture.commands, ctx, {
      pixelRatio: 1,
      resolveImage: makeSyntheticImage,
    });
    return canvas.toDataURL('image/png');
  }
  window.__renderParityFixture = renderParityFixture;
})();

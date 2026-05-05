// code.ts
figma.showUI(__html__, { width: 600, height: 443, themeColors: true });

// ─── Variable Resolution ───────────────────────────────────────────────────

async function resolveVariable(variableId: string): Promise<string | null> {
  if (!variableId) return null;
  try {
    const variable = await figma.variables.getVariableByIdAsync(variableId);
    if (!variable) return null;
    // Convert "colors/primary/default" → "colorsPrimaryDefault" (camelCase)
    return variable.name
      .split('/')
      .map((part, i) =>
        i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)
      )
      .join('');
  } catch (e) {
    return null;
  }
}

// ─── Color Utilities ───────────────────────────────────────────────────────

function figmaColorToFlutterHex(color: RGB | RGBA, opacity: number = 1): string {
  const r = Math.round(color.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(color.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(color.b * 255).toString(16).padStart(2, '0');
  const a = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `0x${a}${r}${g}${b}`.toUpperCase();
}

// ─── Fill Extraction ───────────────────────────────────────────────────────

async function extractFills(node: any) {
  if (!node.fills || !Array.isArray(node.fills)) return null;
  const fills = [];
  const boundVariables = node.boundVariables?.fills;

  for (let i = 0; i < node.fills.length; i++) {
    const fill = node.fills[i];
    if (fill.type === 'SOLID' && fill.visible !== false) {
      let varName: string | null = null;
      if (boundVariables?.[i]?.type === 'VARIABLE_ALIAS') {
        varName = await resolveVariable(boundVariables[i].id);
      }
      fills.push({
        type: 'SOLID',
        color: figmaColorToFlutterHex(fill.color, fill.opacity ?? 1),
        variable: varName,
      });
    }
  }
  return fills.length > 0 ? fills : null;
}

// ─── Font Weight Mapping ───────────────────────────────────────────────────

function mapFontWeight(weight: any): string {
  const w = typeof weight === 'number' ? weight : 400;
  if (w >= 900) return 'FontWeight.w900';
  if (w >= 800) return 'FontWeight.w800';
  if (w >= 700) return 'FontWeight.w700';
  if (w >= 600) return 'FontWeight.w600';
  if (w >= 500) return 'FontWeight.w500';
  if (w >= 400) return 'FontWeight.w400';
  if (w >= 300) return 'FontWeight.w300';
  if (w >= 200) return 'FontWeight.w200';
  return 'FontWeight.w100';
}

// ─── Text Alignment Mapping ────────────────────────────────────────────────

function mapTextAlign(align: string): string | null {
  switch (align) {
    case 'CENTER': return 'TextAlign.center';
    case 'RIGHT': return 'TextAlign.right';
    case 'JUSTIFIED': return 'TextAlign.justify';
    default: return null;
  }
}

// ─── Layout Alignment Mapping ─────────────────────────────────────────────

function mapMainAxis(align: string): string {
  switch (align) {
    case 'CENTER': return 'center';
    case 'SPACE_BETWEEN': return 'spaceBetween';
    case 'MAX': return 'end';
    default: return 'start';
  }
}

function mapCrossAxis(align: string): string {
  switch (align) {
    case 'CENTER': return 'center';
    case 'MAX': return 'end';
    case 'BASELINE': return 'baseline';
    default: return 'start';
  }
}

// ─── Node Data Extraction ─────────────────────────────────────────────────

async function extractNodeData(node: any, depth: number = 0): Promise<any> {
  if (depth > 15) return null;

  const data: any = {
    id: node.id,
    name: node.name,
    type: node.type,
  };

  if ('width' in node) data.width = Math.round(node.width);
  if ('height' in node) data.height = Math.round(node.height);

  // Corner radius (uniform or per-corner)
  if ('cornerRadius' in node && node.cornerRadius !== figma.mixed) {
    data.cornerRadius = node.cornerRadius;
  } else if ('topLeftRadius' in node) {
    data.cornerRadiusTL = node.topLeftRadius ?? 0;
    data.cornerRadiusTR = node.topRightRadius ?? 0;
    data.cornerRadiusBL = node.bottomLeftRadius ?? 0;
    data.cornerRadiusBR = node.bottomRightRadius ?? 0;
  }

  if ('fills' in node) data.fills = await extractFills(node);

  // Stroke/border
  if ('strokes' in node && Array.isArray(node.strokes) && node.strokes.length > 0) {
    const stroke = node.strokes[0];
    if (stroke.type === 'SOLID') {
      data.strokeColor = figmaColorToFlutterHex(stroke.color, stroke.opacity ?? 1);
      data.strokeWidth = node.strokeWeight ?? 1;
    }
  }

  // Auto-layout
  if ('layoutMode' in node && node.layoutMode !== 'NONE') {
    data.layoutMode = node.layoutMode;
    data.primaryAxisAlignItems = node.primaryAxisAlignItems;
    data.counterAxisAlignItems = node.counterAxisAlignItems;
    data.paddingLeft = node.paddingLeft || 0;
    data.paddingRight = node.paddingRight || 0;
    data.paddingTop = node.paddingTop || 0;
    data.paddingBottom = node.paddingBottom || 0;
    data.itemSpacing = node.itemSpacing || 0;
    data.layoutWrap = node.layoutWrap === 'WRAP';
  }

  // Fixed sizing
  if ('layoutSizingHorizontal' in node) {
    data.hug = node.layoutSizingHorizontal === 'HUG';
    data.fill = node.layoutSizingHorizontal === 'FILL';
  }

  // Opacity
  if ('opacity' in node && node.opacity < 1) {
    data.opacity = node.opacity;
  }

  // Text node
  if (node.type === 'TEXT') {
    data.characters = node.characters;
    data.fontSize = node.fontSize !== figma.mixed ? node.fontSize : 14;
    data.fontWeight = node.fontWeight !== figma.mixed ? node.fontWeight : 400;
    data.textAlign = node.textAlignHorizontal ?? 'LEFT';
    data.lineHeight =
      node.lineHeight !== figma.mixed && node.lineHeight?.unit === 'PIXELS'
        ? node.lineHeight.value
        : null;
    data.letterSpacing =
      node.letterSpacing !== figma.mixed && node.letterSpacing?.value !== 0
        ? node.letterSpacing?.value
        : null;

    // Resolve text fill variable
    if (node.boundVariables?.fills?.[0]?.type === 'VARIABLE_ALIAS') {
      const varName = await resolveVariable(node.boundVariables.fills[0].id);
      if (varName && data.fills?.[0]) data.fills[0].variable = varName;
    }
  }

  // Vector / icon node → use SvgPicture placeholder
  if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') {
    data.isVector = true;
  }

  if ('children' in node) {
    data.children = [];
    for (const child of node.children) {
      if (child.visible !== false) {
        const childData = await extractNodeData(child, depth + 1);
        if (childData) data.children.push(childData);
      }
    }
  }

  return data;
}

// ─── Listeners ────────────────────────────────────────────────────────────

const updateSelection = async () => {
  const selection = figma.currentPage.selection;
  const data = selection.length > 0 ? await extractNodeData(selection[0]) : null;
  figma.ui.postMessage({ type: 'selection-change', data });
};

updateSelection();
figma.on('selectionchange', updateSelection);

figma.ui.onmessage = (msg) => {
  if (msg.type === 'cancel') figma.closePlugin();
};
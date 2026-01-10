// Code Sync - Figma Plugin
// Renders components from a GitHub-hosted design system

figma.showUI(__html__, { width: 320, height: 480 });

// Parse GitHub URL to get raw content URL base
function getGitHubRawBase(repoUrl, branch) {
  // Handle formats:
  // https://github.com/user/repo
  // https://github.com/user/repo.git
  const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/);
  if (!match) {
    throw new Error('Invalid GitHub URL format');
  }
  const [, owner, repo] = match;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
}

// Fetch JSON from URL
async function fetchJson(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        return null; // File doesn't exist
      }
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    console.error(`Failed to fetch ${url}:`, err);
    return null;
  }
}

// Resolve token references like "$colors.primary" or "$spacing.md"
function resolveTokenRef(value, tokens) {
  if (typeof value !== 'string' || !value.startsWith('$')) {
    return value;
  }

  const path = value.slice(1).split('.');
  let result = tokens;

  for (const key of path) {
    if (result && typeof result === 'object' && key in result) {
      result = result[key];
    } else {
      console.warn(`Token not found: ${value}`);
      return value;
    }
  }

  return result;
}

// Deep resolve all token references in an object
function resolveTokens(obj, tokens) {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return resolveTokenRef(obj, tokens);
  }

  if (Array.isArray(obj)) {
    return obj.map(item => resolveTokens(item, tokens));
  }

  if (typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveTokens(value, tokens);
    }
    return result;
  }

  return obj;
}

// Convert color token to Figma RGB
function toFigmaColor(color) {
  if (color && typeof color === 'object' && 'figmaValue' in color) {
    return color.figmaValue;
  }
  if (color && typeof color === 'object' && ('r' in color)) {
    return color;
  }
  // If it's a hex string, convert it
  if (typeof color === 'string' && color.startsWith('#')) {
    const hex = color.slice(1);
    return {
      r: parseInt(hex.slice(0, 2), 16) / 255,
      g: parseInt(hex.slice(2, 4), 16) / 255,
      b: parseInt(hex.slice(4, 6), 16) / 255
    };
  }
  return { r: 0.5, g: 0.5, b: 0.5 };
}

// Create a solid paint from a color
function createPaint(color) {
  const rgb = toFigmaColor(color);
  return {
    type: 'SOLID',
    color: rgb
  };
}

// Apply common properties to a node
function applyNodeProperties(node, props) {
  if (props.cornerRadius !== undefined) {
    node.cornerRadius = props.cornerRadius;
  }

  if (props.paddingLeft !== undefined) node.paddingLeft = props.paddingLeft;
  if (props.paddingRight !== undefined) node.paddingRight = props.paddingRight;
  if (props.paddingTop !== undefined) node.paddingTop = props.paddingTop;
  if (props.paddingBottom !== undefined) node.paddingBottom = props.paddingBottom;

  if (props.minWidth !== undefined) node.minWidth = props.minWidth;
  if (props.minHeight !== undefined) node.minHeight = props.minHeight;

  if (props.fills !== undefined) {
    if (Array.isArray(props.fills) && props.fills.length > 0) {
      node.fills = props.fills.map(f => createPaint(f));
    } else {
      node.fills = [];
    }
  }

  if (props.strokes !== undefined) {
    if (Array.isArray(props.strokes) && props.strokes.length > 0) {
      node.strokes = props.strokes.map(s => createPaint(s));
    }
  }

  if (props.strokeWeight !== undefined) {
    node.strokeWeight = props.strokeWeight;
  }

  if (props.layoutMode !== undefined) {
    node.layoutMode = props.layoutMode;
  }

  if (props.primaryAxisAlignItems !== undefined) {
    node.primaryAxisAlignItems = props.primaryAxisAlignItems;
  }

  if (props.counterAxisAlignItems !== undefined) {
    node.counterAxisAlignItems = props.counterAxisAlignItems;
  }

  if (props.itemSpacing !== undefined) {
    node.itemSpacing = props.itemSpacing;
  }
}

// Create a node from a definition
async function createNode(def, tokens) {
  const resolved = resolveTokens(def, tokens);

  if (resolved.type === 'FRAME') {
    const frame = figma.createFrame();
    frame.name = resolved.name || 'Frame';

    // Set auto-layout
    if (resolved.layoutMode) {
      frame.layoutMode = resolved.layoutMode;
      frame.primaryAxisSizingMode = 'AUTO';
      frame.counterAxisSizingMode = 'AUTO';
    }

    applyNodeProperties(frame, resolved);

    // Create children
    if (resolved.children && Array.isArray(resolved.children)) {
      for (const childDef of resolved.children) {
        const child = await createNode(childDef, tokens);
        if (child) {
          frame.appendChild(child);
        }
      }
    }

    return frame;
  }

  if (resolved.type === 'TEXT') {
    const text = figma.createText();
    text.name = resolved.name || 'Text';

    // Load font first
    const fontWeight = resolved.fontWeight || 400;
    let fontStyle = 'Regular';
    if (fontWeight >= 700) fontStyle = 'Bold';
    else if (fontWeight >= 600) fontStyle = 'Semi Bold';
    else if (fontWeight >= 500) fontStyle = 'Medium';

    try {
      await figma.loadFontAsync({ family: 'Inter', style: fontStyle });
    } catch {
      // Fallback to default font
      await figma.loadFontAsync({ family: 'Roboto', style: 'Regular' });
    }

    text.fontName = { family: 'Inter', style: fontStyle };
    text.characters = resolved.characters || 'Text';

    if (resolved.fontSize) {
      text.fontSize = resolved.fontSize;
    }

    if (resolved.fills) {
      text.fills = resolved.fills.map(f => createPaint(f));
    }

    return text;
  }

  if (resolved.type === 'RECTANGLE') {
    const rect = figma.createRectangle();
    rect.name = resolved.name || 'Rectangle';
    applyNodeProperties(rect, resolved);
    return rect;
  }

  return null;
}

// Deep merge objects
function deepMerge(target, source) {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (source[key] instanceof Object && key in target && target[key] instanceof Object) {
      if (Array.isArray(source[key]) && Array.isArray(target[key])) {
        // For arrays of children, we need special handling
        if (key === 'children') {
          result[key] = mergeChildren(target[key], source[key]);
        } else {
          result[key] = source[key];
        }
      } else {
        result[key] = deepMerge(target[key], source[key]);
      }
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

// Merge child overrides by name
function mergeChildren(baseChildren, overrideChildren) {
  const result = [...baseChildren];

  for (const override of overrideChildren) {
    if (override.name) {
      const index = result.findIndex(c => c.name === override.name);
      if (index !== -1) {
        result[index] = deepMerge(result[index], override);
      }
    }
  }

  return result;
}

// Generate all variant combinations
function getVariantCombinations(variants) {
  const keys = Object.keys(variants);
  if (keys.length === 0) return [{}];

  const combinations = [];

  function generate(index, current) {
    if (index === keys.length) {
      combinations.push({ ...current });
      return;
    }

    const key = keys[index];
    const values = variants[key];

    for (const value of values) {
      current[key] = value;
      generate(index + 1, current);
    }
  }

  generate(0, {});
  return combinations;
}

// Apply variant overrides to base definition
function applyVariantOverrides(base, variantOverrides, variantValues) {
  let result = { ...base };

  for (const [key, value] of Object.entries(variantValues)) {
    if (variantOverrides[key] && variantOverrides[key][value]) {
      result = deepMerge(result, variantOverrides[key][value]);
    }
  }

  return result;
}

// Render a single component with all its variants
async function renderComponent(component, tokens) {
  const variants = component.variants || {};
  const variantOverrides = component.variantOverrides || {};
  const combinations = getVariantCombinations(variants);

  // Create a container frame for all variants
  const container = figma.createFrame();
  container.name = component.name;
  container.layoutMode = 'VERTICAL';
  container.primaryAxisSizingMode = 'AUTO';
  container.counterAxisSizingMode = 'AUTO';
  container.itemSpacing = 24;
  container.paddingTop = 24;
  container.paddingBottom = 24;
  container.paddingLeft = 24;
  container.paddingRight = 24;
  container.fills = [{ type: 'SOLID', color: { r: 0.98, g: 0.98, b: 0.98 } }];

  // Add title
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' });
  const title = figma.createText();
  title.fontName = { family: 'Inter', style: 'Bold' };
  title.fontSize = 18;
  title.characters = component.name;
  container.appendChild(title);

  // Group variants by first variant key for organization
  const variantKeys = Object.keys(variants);

  if (variantKeys.length === 0) {
    // No variants, just render the base
    const node = await createNode(component.base, tokens);
    if (node) {
      container.appendChild(node);
    }
  } else {
    // Render all variant combinations
    const rowFrame = figma.createFrame();
    rowFrame.name = 'Variants';
    rowFrame.layoutMode = 'HORIZONTAL';
    rowFrame.primaryAxisSizingMode = 'AUTO';
    rowFrame.counterAxisSizingMode = 'AUTO';
    rowFrame.itemSpacing = 16;
    rowFrame.fills = [];

    for (const combo of combinations) {
      const variantDef = applyVariantOverrides(component.base, variantOverrides, combo);

      // Create a wrapper with label
      const wrapper = figma.createFrame();
      wrapper.layoutMode = 'VERTICAL';
      wrapper.primaryAxisSizingMode = 'AUTO';
      wrapper.counterAxisSizingMode = 'AUTO';
      wrapper.itemSpacing = 8;
      wrapper.fills = [];

      // Variant label
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      const label = figma.createText();
      label.fontName = { family: 'Inter', style: 'Regular' };
      label.fontSize = 10;
      label.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }];
      label.characters = Object.entries(combo).map(([k, v]) => `${k}: ${v}`).join(', ');
      wrapper.appendChild(label);

      // The actual component
      const node = await createNode(variantDef, tokens);
      if (node) {
        node.name = Object.values(combo).join('/');
        wrapper.appendChild(node);
      }

      rowFrame.appendChild(wrapper);
    }

    container.appendChild(rowFrame);
  }

  return container;
}

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'fetch-components') {
    try {
      const baseUrl = getGitHubRawBase(msg.repoUrl, msg.branch);

      // Fetch tokens
      const [colors, spacing, typography] = await Promise.all([
        fetchJson(`${baseUrl}/tokens/colors.json`),
        fetchJson(`${baseUrl}/tokens/spacing.json`),
        fetchJson(`${baseUrl}/tokens/typography.json`)
      ]);

      const tokens = {
        colors: colors || {},
        spacing: spacing || {},
        typography: typography || {}
      };

      // For POC, we'll fetch known component files
      // In production, you'd list the directory via GitHub API
      const componentNames = ['button', 'input', 'card', 'badge', 'avatar'];
      const components = [];

      for (const name of componentNames) {
        const comp = await fetchJson(`${baseUrl}/components/${name}.json`);
        if (comp) {
          components.push(comp);
        }
      }

      if (components.length === 0) {
        figma.ui.postMessage({
          type: 'error',
          message: 'No components found in repository'
        });
        return;
      }

      figma.ui.postMessage({
        type: 'components-fetched',
        components,
        tokens
      });
    } catch (err) {
      figma.ui.postMessage({
        type: 'error',
        message: `Failed to fetch: ${err.message}`
      });
    }
  }

  if (msg.type === 'render-component') {
    try {
      const container = await renderComponent(msg.component, msg.tokens);

      // Position in viewport
      const viewport = figma.viewport.center;
      container.x = viewport.x - container.width / 2;
      container.y = viewport.y - container.height / 2;

      figma.currentPage.appendChild(container);
      figma.currentPage.selection = [container];
      figma.viewport.scrollAndZoomIntoView([container]);

      figma.ui.postMessage({
        type: 'render-complete',
        message: `Rendered ${msg.component.name} with ${getVariantCombinations(msg.component.variants || {}).length} variant(s)`
      });
    } catch (err) {
      figma.ui.postMessage({
        type: 'error',
        message: `Render failed: ${err.message}`
      });
    }
  }

  if (msg.type === 'render-all') {
    try {
      const containers = [];
      let xOffset = 0;

      for (const component of msg.components) {
        const container = await renderComponent(component, msg.tokens);

        const viewport = figma.viewport.center;
        container.x = viewport.x + xOffset;
        container.y = viewport.y - container.height / 2;

        figma.currentPage.appendChild(container);
        containers.push(container);

        xOffset += container.width + 48;
      }

      figma.currentPage.selection = containers;
      figma.viewport.scrollAndZoomIntoView(containers);

      figma.ui.postMessage({
        type: 'render-complete',
        message: `Rendered ${msg.components.length} component(s)`
      });
    } catch (err) {
      figma.ui.postMessage({
        type: 'error',
        message: `Render failed: ${err.message}`
      });
    }
  }
};

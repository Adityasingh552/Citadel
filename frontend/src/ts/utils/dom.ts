/** DOM utility helpers. */

export function $el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs?: Record<string, string>,
    children?: (Node | string)[],
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (attrs) {
        Object.entries(attrs).forEach(([k, v]) => {
            if (k === 'className') el.className = v;
            else if (k === 'innerHTML') el.innerHTML = v;
            else if (k === 'textContent') el.textContent = v;
            else el.setAttribute(k, v);
        });
    }
    if (children) {
        children.forEach(c => {
            el.append(typeof c === 'string' ? document.createTextNode(c) : c);
        });
    }
    return el;
}

export function $qs<T extends HTMLElement>(selector: string, parent: ParentNode = document): T | null {
    return parent.querySelector<T>(selector);
}

export function $qsa<T extends HTMLElement>(selector: string, parent: ParentNode = document): T[] {
    return Array.from(parent.querySelectorAll<T>(selector));
}

export function html(parent: HTMLElement, content: string): void {
    parent.innerHTML = content;
}

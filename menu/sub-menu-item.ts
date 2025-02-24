/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {customElement} from 'lit/decorators.js';

import {styles as listItemForcedColorsStyles} from '../list/internal/listitem/forced-colors-styles.css.js';
import {styles as listItemStyles} from '../list/internal/listitem/list-item-styles.css.js';

import {styles as forcedColorsStyles} from './internal/menuitem/forced-colors-styles.css.js';
import {styles} from './internal/menuitem/menu-item-styles.css.js';
import {SubMenuItem} from './internal/submenuitem/sub-menu-item.js';

export {ListItem} from '../list/internal/listitem/list-item.js';
export {CloseMenuEvent, MenuItem} from './internal/shared.js';

declare global {
  interface HTMLElementTagNameMap {
    'md-sub-menu-item': MdSubMenuItem;
  }
}

/**
 * @summary Menus display a list of choices on a temporary surface.
 * @deprecated Use <md-submenu>
 *
 * @description
 * Menu items are the selectable choices within the menu. Menu items must
 * implement the `Menu` interface and also have the `md-menu`
 * attribute. Additionally menu items are list items so they must also have the
 * `md-list-item` attribute.
 *
 * Menu items can control a menu by selectively firing the `close-menu` and
 * `deselect-items` events.
 *
 * This menu item will open a sub-menu that is slotted in the `submenu` slot.
 * Additionally, the containing menu must either have `has-overflow` or `fixed`
 * set to `true` in order to display the containing menu properly.
 *
 * @example
 * ```html
 * <div style="position:relative;">
 *   <button
 *       id="anchor"
 *       @click=${() => this.menuRef.value.show()}>
 *     Click to open menu
 *   </button>
 *   <!--
 *     `has-overflow` is required when using a submenu which overflows the
 *     menu's contents
 *   -->
 *   <md-menu anchor="anchor" has-overflow ${ref(menuRef)}>
 *     <md-menu-item headline="This is a headline"></md-menu-item>
 *     <md-sub-menu>
 *       <md-menu-item
 *           slot="item"
 *           headline="this is a submenu item">
 *       </md-menu-item>
 *       <md-menu slot="menu">
 *         <md-menu-item headline="This is an item inside a submenu">
 *         </md-menu-item>
 *       </md-menu>
 *     </md-sub-menu>
 *   </md-menu>
 * </div>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
@customElement('md-sub-menu-item')
export class MdSubMenuItem extends SubMenuItem {
  static override styles =
      [listItemStyles, styles, listItemForcedColorsStyles, forcedColorsStyles];
}

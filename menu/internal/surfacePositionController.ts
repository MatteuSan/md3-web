/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {ReactiveController, ReactiveControllerHost} from 'lit';
import {StyleInfo} from 'lit/directives/style-map.js';

/**
 * An enum of supported Menu corners
 */
// tslint:disable-next-line:enforce-name-casing We are mimicking enum style
export const Corner = {
  END_START: 'end-start',
  END_END: 'end-end',
  START_START: 'start-start',
  START_END: 'start-end',
} as const;

/**
 * A corner of a box in the standard logical property style of <block>_<inline>
 */
export type Corner = typeof Corner[keyof typeof Corner];

/**
 * An interface that provides a method to customize the rect from which to
 * calculate the anchor positioning. Useful for when you want a surface to
 * anchor to an element in your shadow DOM rather than the host element.
 */
export interface SurfacePositionTarget extends HTMLElement {
  getSurfacePositionClientRect?: () => DOMRect;
}

/**
 * The configurable options for the surface position controller.
 */
export interface SurfacePositionControllerProperties {
  /**
   * The corner of the anchor to align the surface's position.
   */
  anchorCorner: Corner;
  /**
   * The corner of the surface to align to the given anchor corner.
   */
  surfaceCorner: Corner;
  /**
   * The HTMLElement reference of the surface to be positioned.
   */
  surfaceEl: SurfacePositionTarget|null;
  /**
   * The HTMLElement reference of the anchor to align to.
   */
  anchorEl: SurfacePositionTarget|null;
  /**
   * Whether or not the calculation should be relative to the top layer rather
   * than relative to the parent of the anchor.
   *
   * Examples for `isTopLayer:true`:
   *
   * - If there is no `position:relative` in the given parent tree and the
   *   surface is `position:absolute`
   * - If the surface is `position:fixed`
   * - If the surface is in the "top layer"
   * - The anchor and the surface do not share a common `position:relative`
   *   ancestor
   */
  isTopLayer: boolean;
  /**
   * Whether or not the surface should be "open" and visible
   */
  isOpen: boolean;
  /**
   * The number of pixels in which to offset from the inline axis relative to
   * logical property.
   *
   * Positive is right in LTR and left in RTL.
   */
  xOffset: number;
  /**
   * The number of pixes in which to offset the block axis.
   *
   * Positive is down and negative is up.
   */
  yOffset: number;
  /**
   * The strategy to follow when repositioning the menu to stay inside the
   * viewport. "move" will simply move the surface to stay in the viewport.
   * "resize" will attempt to resize the surface.
   *
   * Both strategies will still attempt to flip the anchor and surface corners.
   */
  repositionStrategy: 'move'|'resize';
  /**
   * A function to call after the surface has been positioned.
   */
  onOpen: () => void;
  /**
   * A function to call before the surface should be closed. (A good time to
   * perform animations while the surface is still visible)
   */
  beforeClose: () => Promise<void>;
  /**
   * A function to call after the surface has been closed.
   */
  onClose: () => void;
}

/**
 * Given a surface, an anchor, corners, and some options, this surface will
 * calculate the position of a surface to align the two given corners and keep
 * the surface inside the window viewport. It also provides a StyleInfo map that
 * can be applied to the surface to handle visiblility and position.
 */
export class SurfacePositionController implements ReactiveController {
  // The current styles to apply to the surface.
  private surfaceStylesInternal: StyleInfo = {
    'display': 'none',
  };
  // Previous values stored for change detection. Open change detection is
  // calculated separately so initialize it here.
  private lastValues: SurfacePositionControllerProperties = {isOpen: false} as
      SurfacePositionControllerProperties;

  /**
   * @param host The host to connect the controller to.
   * @param getProperties A function that returns the properties for the
   * controller.
   */
  constructor(
      private readonly host: ReactiveControllerHost,
      private readonly getProperties: () => SurfacePositionControllerProperties,
  ) {
    this.host.addController(this);
  }

  /**
   * The StyleInfo map to apply to the surface via Lit's stylemap
   */
  get surfaceStyles() {
    return this.surfaceStylesInternal;
  }

  /**
   * Calculates the surface's new position required so that the surface's
   * `surfaceCorner` aligns to the anchor's `anchorCorner` while keeping the
   * surface inside the window viewport. This positioning also respects RTL by
   * checking `getComputedStyle()` on the surface element.
   */
  async position() {
    const {
      surfaceEl,
      anchorEl,
      anchorCorner: anchorCornerRaw,
      surfaceCorner: surfaceCornerRaw,
      isTopLayer,
      xOffset,
      yOffset,
      repositionStrategy,
    } = this.getProperties();
    const anchorCorner = anchorCornerRaw.toLowerCase().trim();
    const surfaceCorner = surfaceCornerRaw.toLowerCase().trim();

    if (!surfaceEl || !anchorEl) {
      return;
    }

    // Paint the surface transparently so that we can get the position and the
    // rect info of the surface.
    this.surfaceStylesInternal = {
      'display': 'block',
      'opacity': '0',
    };

    // Wait for it to be visible.
    this.host.requestUpdate();
    await this.host.updateComplete;

    const surfaceRect = surfaceEl.getSurfacePositionClientRect ?
        surfaceEl.getSurfacePositionClientRect() :
        surfaceEl.getBoundingClientRect();
    const anchorRect = anchorEl.getSurfacePositionClientRect ?
        anchorEl.getSurfacePositionClientRect() :
        anchorEl.getBoundingClientRect();
    const [surfaceBlock, surfaceInline] =
        surfaceCorner.split('-') as Array<'start'|'end'>;
    const [anchorBlock, anchorInline] =
        anchorCorner.split('-') as Array<'start'|'end'>;

    // LTR depends on the direction of the SURFACE not the anchor.
    const isLTR =
        getComputedStyle(surfaceEl as HTMLElement).direction === 'ltr';

    /*
     * A diagram that helps describe some of the variables used in the following
     * calculations.
     *
     * ┌───── inline/blockTopLayerOffset
     * │       │
     * │     ┌─▼───┐                  Window
     * │    ┌┼─────┴────────────────────────┐
     * │    ││                              │
     * └──► ││  ┌──inline/blockAnchorOffset │
     *      ││  │     │                     │
     *      └┤  │  ┌──▼───┐                 │
     *       │  │ ┌┼──────┤                 │
     *       │  └─►│Anchor│                 │
     *       │    └┴──────┘                 │
     *       │                              │
     *       │     ┌────────────────────────┼────┐
     *       │     │ Surface                │    │
     *       │     │                        │    │
     *       │     │                        │    │
     *       │     │                        │    │
     *       │     │                        │    │
     *       │     │                        │    │
     *       └─────┼────────────────────────┘    ├┐
     *             │ inline/blockOOBCorrection   ││
     *             │                         │   ││
     *             │                         ├──►││
     *             │                         │   ││
     *             └────────────────────────┐▼───┼┘
     *                                      └────┘
     */

    // Calculate the block positioning properties
    let {blockInset, blockOutOfBoundsCorrection, surfaceBlockProperty} =
        this.calculateBlock({
          surfaceRect,
          anchorRect,
          anchorBlock,
          surfaceBlock,
          yOffset,
          isTopLayer
        });

    // If the surface should be out of bounds in the block direction, flip the
    // surface and anchor corner block values and recalculate
    if (blockOutOfBoundsCorrection) {
      const flippedSurfaceBlock = surfaceBlock === 'start' ? 'end' : 'start';
      const flippedAnchorBlock = anchorBlock === 'start' ? 'end' : 'start';

      const flippedBlock = this.calculateBlock({
        surfaceRect,
        anchorRect,
        anchorBlock: flippedAnchorBlock,
        surfaceBlock: flippedSurfaceBlock,
        yOffset,
        isTopLayer
      });

      // In the case that the flipped verion would require less out of bounds
      // correcting, use the flipped corner block values
      if (blockOutOfBoundsCorrection >
          flippedBlock.blockOutOfBoundsCorrection) {
        blockInset = flippedBlock.blockInset;
        blockOutOfBoundsCorrection = flippedBlock.blockOutOfBoundsCorrection;
        surfaceBlockProperty = flippedBlock.surfaceBlockProperty;
      }
    }

    // Calculate the inline positioning properties
    let {inlineInset, inlineOutOfBoundsCorrection, surfaceInlineProperty} =
        this.calculateInline({
          surfaceRect,
          anchorRect,
          anchorInline,
          surfaceInline,
          xOffset,
          isTopLayer,
          isLTR,
        });

    // If the surface should be out of bounds in the inline direction, flip the
    // surface and anchor corner inline values and recalculate
    if (inlineOutOfBoundsCorrection) {
      const flippedSurfaceInline = surfaceInline === 'start' ? 'end' : 'start';
      const flippedAnchorInline = anchorInline === 'start' ? 'end' : 'start';

      const flippedInline = this.calculateInline({
        surfaceRect,
        anchorRect,
        anchorInline: flippedAnchorInline,
        surfaceInline: flippedSurfaceInline,
        xOffset,
        isTopLayer,
        isLTR,
      });

      // In the case that the flipped verion would require less out of bounds
      // correcting, use the flipped corner inline values
      if (Math.abs(inlineOutOfBoundsCorrection) >
          Math.abs(flippedInline.inlineOutOfBoundsCorrection)) {
        inlineInset = flippedInline.inlineInset;
        inlineOutOfBoundsCorrection = flippedInline.inlineOutOfBoundsCorrection;
        surfaceInlineProperty = flippedInline.surfaceInlineProperty;
      }
    }

    // If we are simply repositioning the surface back inside the viewport,
    // subtract the out of bounds correction values from the positioning.
    if (repositionStrategy === 'move') {
      blockInset = blockInset - blockOutOfBoundsCorrection;
      inlineInset = inlineInset - inlineOutOfBoundsCorrection;
    }

    this.surfaceStylesInternal = {
      'display': 'block',
      'opacity': '1',
      [surfaceBlockProperty]: `${blockInset}px`,
      [surfaceInlineProperty]: `${inlineInset}px`,
    };

    // In the case that we are resizing the surface to stay inside the viewport
    // we need to set height and width on the surface.
    if (repositionStrategy === 'resize') {
      // Add a height property to the styles if there is block height correction
      if (blockOutOfBoundsCorrection) {
        this.surfaceStylesInternal['height'] =
            `${surfaceRect.height - blockOutOfBoundsCorrection}px`;
      }

      // Add a width property to the styles if there is block height correction
      if (inlineOutOfBoundsCorrection) {
        this.surfaceStylesInternal['width'] =
            `${surfaceRect.width - inlineOutOfBoundsCorrection}px`;
      }
    }

    this.host.requestUpdate();
  }

  /**
   * Calculates the css property, the inset, and the out of bounds correction
   * for the surface in the block direction.
   */
  private calculateBlock(config: {
    surfaceRect: DOMRect,
    anchorRect: DOMRect,
    anchorBlock: 'start'|'end',
    surfaceBlock: 'start'|'end',
    yOffset: number,
    isTopLayer: boolean,
  }) {
    const {
      surfaceRect,
      anchorRect,
      anchorBlock,
      surfaceBlock,
      yOffset,
      isTopLayer: isTopLayerBool,
    } = config;
    // We use number booleans to multiply values rather than `if` / ternary
    // statements because it _heavily_ cuts down on nesting and readability
    const isTopLayer = isTopLayerBool ? 1 : 0;
    const isSurfaceBlockStart = surfaceBlock === 'start' ? 1 : 0;
    const isSurfaceBlockEnd = surfaceBlock === 'end' ? 1 : 0;
    const isOneBlockEnd = anchorBlock !== surfaceBlock ? 1 : 0;

    // Whether or not to apply the height of the anchor
    const blockAnchorOffset = isOneBlockEnd * anchorRect.height + yOffset;
    // The absolute block position of the anchor relative to window
    const blockTopLayerOffset = isSurfaceBlockStart * anchorRect.top +
        isSurfaceBlockEnd * (window.innerHeight - anchorRect.bottom);
    // If the surface's block would be out of bounds of the window, move it back
    // in
    const blockOutOfBoundsCorrection = Math.abs(Math.min(
        0,
        window.innerHeight - blockTopLayerOffset - blockAnchorOffset -
            surfaceRect.height));


    // The block logical value of the surface
    const blockInset = isTopLayer * blockTopLayerOffset + blockAnchorOffset;

    const surfaceBlockProperty =
        surfaceBlock === 'start' ? 'inset-block-start' : 'inset-block-end';

    return {blockInset, blockOutOfBoundsCorrection, surfaceBlockProperty};
  }

  /**
   * Calculates the css property, the inset, and the out of bounds correction
   * for the surface in the inline direction.
   */
  private calculateInline(config: {
    isLTR: boolean,
    surfaceInline: 'start'|'end',
    anchorInline: 'start'|'end',
    anchorRect: DOMRect,
    surfaceRect: DOMRect,
    xOffset: number,
    isTopLayer: boolean,
  }) {
    const {
      isLTR: isLTRBool,
      surfaceInline,
      anchorInline,
      anchorRect,
      surfaceRect,
      xOffset,
      isTopLayer: isTopLayerBool,
    } = config;
    // We use number booleans to multiply values rather than `if` / ternary
    // statements because it _heavily_ cuts down on nesting and readability
    const isTopLayer = isTopLayerBool ? 1 : 0;
    const isLTR = isLTRBool ? 1 : 0;
    const isRTL = isLTRBool ? 0 : 1;
    const isSurfaceInlineStart = surfaceInline === 'start' ? 1 : 0;
    const isSurfaceInlineEnd = surfaceInline === 'end' ? 1 : 0;
    const isOneInlineEnd = anchorInline !== surfaceInline ? 1 : 0;

    // Whether or not to apply the width of the anchor
    const inlineAnchorOffset = isOneInlineEnd * anchorRect.width + xOffset;
    // The inline position of the anchor relative to window in LTR
    const inlineTopLayerOffsetLTR = isSurfaceInlineStart * anchorRect.left +
        isSurfaceInlineEnd * (window.innerWidth - anchorRect.right);
    // The inline position of the anchor relative to window in RTL
    const inlineTopLayerOffsetRTL =
        isSurfaceInlineStart * (window.innerWidth - anchorRect.right) +
        isSurfaceInlineEnd * anchorRect.left;
    // The inline position of the anchor relative to window
    const inlineTopLayerOffset =
        isLTR * inlineTopLayerOffsetLTR + isRTL * inlineTopLayerOffsetRTL;

    // If the surface's inline would be out of bounds of the window, move it
    // back in
    const inlineOutOfBoundsCorrection = Math.abs(Math.min(
        0,
        window.innerWidth - inlineTopLayerOffset - inlineAnchorOffset -
            surfaceRect.width));


    // The inline logical value of the surface
    const inlineInset = isTopLayer * inlineTopLayerOffset + inlineAnchorOffset;

    const surfaceInlineProperty =
        surfaceInline === 'start' ? 'inset-inline-start' : 'inset-inline-end';

    return {
      inlineInset,
      inlineOutOfBoundsCorrection,
      surfaceInlineProperty,
    };
  }

  hostUpdate() {
    this.onUpdate();
  }

  hostUpdated() {
    this.onUpdate();
  }

  /**
   * Checks whether the properties passed into the controller have changed since
   * the last positioning. If so, it will reposition if the surface is open or
   * close it if the surface should close.
   */
  private async onUpdate() {
    const props = this.getProperties();
    let hasChanged = false;
    for (const [key, value] of Object.entries(props)) {
      // tslint:disable-next-line
      hasChanged = hasChanged || (value !== (this.lastValues as any)[key]);
      if (hasChanged) break;
    }

    const openChanged = this.lastValues.isOpen !== props.isOpen;
    const hasAnchor = !!props.anchorEl;
    const hasSurface = !!props.surfaceEl;

    if (hasChanged && hasAnchor && hasSurface) {
      // Only update isOpen, because if it's closed, we do not want to waste
      // time on a useless reposition calculation. So save the other "dirty"
      // values until next time it opens.
      this.lastValues.isOpen = props.isOpen;

      if (props.isOpen) {
        // We are going to do a reposition, so save the prop values for future
        // dirty checking.
        this.lastValues = props;

        await this.position();
        props.onOpen();
      } else if (openChanged) {
        await props.beforeClose();
        this.close();
        props.onClose();
      }
    }
  }

  /**
   * Hides the surface.
   */
  private close() {
    this.surfaceStylesInternal = {
      'display': 'none',
    };
    this.host.requestUpdate();
  }
}

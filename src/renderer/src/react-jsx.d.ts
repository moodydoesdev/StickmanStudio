// React 19's types moved the JSX namespace under `React.JSX` and stopped
// exposing a global `JSX`. Re-expose just enough so existing
// `: JSX.Element` return annotations keep resolving.
import type * as React from 'react'

declare global {
  namespace JSX {
    type Element = React.JSX.Element
    type ElementClass = React.JSX.ElementClass
    type IntrinsicElements = React.JSX.IntrinsicElements
  }
}

export {}

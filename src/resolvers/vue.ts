import {
  isCatchAllRoute,
  isDynamicRoute,
} from '../utils'
import { generateClientCode } from '../stringify'

import type { CustomBlock, Optional } from '../types'
import type { PageContext } from '../context'

interface Route {
  name: string
  path: string
  props?: boolean
  component: string
  children?: Route[]
  customBlock?: CustomBlock
  rawRoute: string
}

type PrepareRoutes = Omit<Optional<Route, 'rawRoute' | 'name'>, 'children'> & {
  children?: PrepareRoutes[]
}

function prepareRoutes(
  ctx: PageContext,
  routes: PrepareRoutes[],
  parent?: PrepareRoutes,
) {
  for (const route of routes) {
    if (route.name)
      route.name = route.name.replace(/-index$/, '')

    if (parent)
      route.path = route.path?.replace(/^\//, '')

    if (route.children) {
      delete route.name
      route.children = prepareRoutes(ctx, route.children, route)
    }

    route.props = true

    delete route.rawRoute

    if (route.customBlock) {
      Object.assign(route, route.customBlock || {})
      delete route.customBlock
    }

    Object.assign(route, ctx.options.extendRoute?.(route, parent) || {})
  }

  return routes
}

export async function resolveVueRoutes(ctx: PageContext) {
  const { nuxtStyle } = ctx.options

  const pageRoutes = [...ctx.pageRouteMap.values()]

  const routes: Route[] = []

  pageRoutes.forEach((page) => {
    const pathNodes = page.route.split('/')

    // add leading slash to component path if not already there
    const component = page.path.replace(ctx.root, '')
    const customBlock = ctx.customBlockMap.get(page.path)

    const route: Route = {
      name: '',
      path: '',
      component,
      customBlock,
      rawRoute: page.route,
    }

    let parentRoutes = routes

    for (let i = 0; i < pathNodes.length; i++) {
      const node = pathNodes[i]
      const isDynamic = isDynamicRoute(node, nuxtStyle)
      const isCatchAll = isCatchAllRoute(node, nuxtStyle)
      const normalizedName = isDynamic
        ? nuxtStyle
          ? isCatchAll ? 'all' : node.replace(/^_/, '')
          : node.replace(/^\[(\.{3})?/, '').replace(/\]$/, '')
        : node
      const normalizedPath = normalizedName.toLowerCase()

      route.name += route.name ? `-${normalizedName}` : normalizedName

      // Check parent exits
      const parent = parentRoutes.find((parent) => {
        return pathNodes.slice(0, i + 1).join('/') === parent.rawRoute
      })

      if (parent) {
        // Make sure children exits in parent
        parent.children = parent.children || []
        // Append to parent's children
        parentRoutes = parent.children
        // Reset path
        route.path = ''
      } else if (normalizedName.toLowerCase() === 'index') {
        if (!route.path)
          route.path = '/'
      } else if (normalizedName.toLowerCase() !== 'index') {
        if (isDynamic) {
          route.path += `/:${normalizedName}`
          // Catch-all route
          if (isCatchAll) {
            if (i === 0)
              // root cache all route include children
              route.path += '(.*)*'
            else
              // nested cache all route not include children
              route.path += '(.*)'
          }
        } else {
          route.path += `/${normalizedPath}`
        }
      }
    }

    parentRoutes.push(route)
  })

  let finalRoutes = prepareRoutes(ctx, routes)

  finalRoutes = (await ctx.options.onRoutesGenerated?.(finalRoutes)) || finalRoutes

  let client = generateClientCode(finalRoutes, ctx.options)
  client = (await ctx.options.onClientGenerated?.(client)) || client
  return client
}

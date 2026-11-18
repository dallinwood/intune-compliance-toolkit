import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"

function Menu(props: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root {...props} />
}

function MenuTrigger(props: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="menu-trigger" {...props} />
}

function MenuContent({
  className,
  side = "bottom",
  align = "start",
  sideOffset = 6,
  children,
  ...props
}: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, "side" | "align" | "sideOffset">) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner side={side} align={align} sideOffset={sideOffset} collisionPadding={8} className="z-50">
        <MenuPrimitive.Popup
          data-slot="menu-content"
          className={cn(
            "min-w-40 max-w-[calc(100vw-1rem)] rounded-md bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none dark:ring-1 dark:ring-white/10",
            className
          )}
          {...props}
        >
          {children}
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

// A menu entry that is a real link, so it can still open in a new tab.
function MenuLinkItem({ className, ...props }: MenuPrimitive.LinkItem.Props) {
  return (
    <MenuPrimitive.LinkItem
      data-slot="menu-link-item"
      className={cn(
        "block cursor-default rounded-sm px-2 py-1.5 outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Menu, MenuTrigger, MenuContent, MenuLinkItem }

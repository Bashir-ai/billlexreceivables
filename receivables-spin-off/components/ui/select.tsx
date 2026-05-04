import * as React from "react"
import { cn } from "@/lib/utils"

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  searchable?: boolean
  searchPlaceholder?: string
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, searchable = true, searchPlaceholder = "Type to filter...", value, ...props }, ref) => {
    const [query, setQuery] = React.useState("")
    const [open, setOpen] = React.useState(false)
    const wrapperRef = React.useRef<HTMLDivElement | null>(null)
    const selectedValue = value !== undefined && value !== null ? String(value) : ""

    const options = React.useMemo(() => {
      const all = React.Children.toArray(children)
      const opts = all
        .filter((child) => {
          if (!React.isValidElement(child)) return false
          const t = child.type as any
          return typeof t === "string" && t.toLowerCase() === "option"
        })
        .map((child) => {
          const c = child as React.ReactElement<any>
          const rawValue = c.props?.value
          const optionValue =
            rawValue === undefined || rawValue === null ? "" : String(rawValue)
          const label = React.Children.toArray(c.props?.children || [])
            .map((x) =>
              typeof x === "string" || typeof x === "number" ? String(x) : ""
            )
            .join(" ")
            .trim()
          return { value: optionValue, label }
        })
      return opts.sort((a, b) => {
        if (a.value === "" && b.value !== "") return -1
        if (b.value === "" && a.value !== "") return 1
        return a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
      })
    }, [children])

    const selectedLabel = React.useMemo(() => {
      const m = options.find((o) => o.value === selectedValue)
      return m?.label ?? ""
    }, [options, selectedValue])

    const filteredOptions = React.useMemo(() => {
      const q = query.trim().toLowerCase()
      if (!q) return options
      return options.filter((o) => {
        if (o.value === "") return true
        if (o.value === selectedValue) return true
        return (
          o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
        )
      })
    }, [options, query, selectedValue])

    React.useEffect(() => {
      if (!open) return
      const onPointerDown = (event: MouseEvent) => {
        const target = event.target as Node | null
        if (wrapperRef.current && target && !wrapperRef.current.contains(target)) {
          setOpen(false)
          setQuery("")
        }
      }
      document.addEventListener("mousedown", onPointerDown)
      return () => document.removeEventListener("mousedown", onPointerDown)
    }, [open])

    const commitValue = (nextValue: string) => {
      const eventLike = {
        target: { value: nextValue, name: props.name, id: props.id },
        currentTarget: { value: nextValue, name: props.name, id: props.id },
      } as unknown as React.ChangeEvent<HTMLSelectElement>
      props.onChange?.(eventLike)
    }

    return (
      searchable ? (
        <div ref={wrapperRef} className="relative w-full">
          <input
            type="text"
            value={open ? query : selectedLabel}
            placeholder={selectedLabel || searchPlaceholder}
            className={cn(
              "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
              className
            )}
            onFocus={() => {
              setOpen(true)
              setQuery("")
            }}
            onChange={(e) => {
              setOpen(true)
              setQuery(e.target.value)
            }}
            disabled={props.disabled}
          />
          {open ? (
            <div className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-background shadow-md">
              {filteredOptions.map((opt) => (
                <button
                  key={`opt-${opt.value || "__empty__"}`}
                  type="button"
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm hover:bg-muted",
                    opt.value === selectedValue && "bg-muted"
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    commitValue(opt.value)
                    setOpen(false)
                    setQuery("")
                  }}
                >
                  {opt.label || "—"}
                </button>
              ))}
              {filteredOptions.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">No matches</div>
              ) : null}
            </div>
          ) : null}
          <select
            ref={ref}
            value={value}
            {...props}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          >
            {children}
          </select>
        </div>
      ) : (
        <select
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          ref={ref}
          value={value}
          {...props}
        >
          {children}
        </select>
      )
    )
  }
)
Select.displayName = "Select"

export { Select }










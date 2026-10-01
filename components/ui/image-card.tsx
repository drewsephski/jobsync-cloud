import { cn } from "@/lib/utils"

type Props = {
  imageUrl: string
  caption: string
  className?: string
}

export default function ImageCard({ imageUrl, caption, className }: Props) {
  return (
    <figure
      className={cn(
        "w-[250px] overflow-hidden rounded-base border border-border bg-background font-base shadow-shadow",
        className,
      )}
    >
      <img className="w-full aspect-4/3" src={imageUrl} alt="image" />
      <figcaption className="border-t text-foreground border-border p-4">
        {caption}
      </figcaption>
    </figure>
  )
}

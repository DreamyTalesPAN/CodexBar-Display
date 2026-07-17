"use client";

import {
  AlertCircle,
  Check,
  ChevronRight,
  CloudUpload,
  Download,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Play,
  Save,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wifi,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const tokenSwatches = [
  { label: "Signal", value: "#CCFF00", className: "bg-primary" },
  { label: "Ink", value: "#1B1B1B", className: "bg-foreground" },
  { label: "Canvas", value: "#F9F9F9", className: "bg-background" },
  { label: "Muted", value: "#EEEEEE", className: "bg-muted" },
  { label: "Stroke", value: "#E3E3E3", className: "bg-border" },
  { label: "Input", value: "#888888", className: "bg-input" },
  { label: "Support", value: "#506600", className: "bg-ring" },
];

export function VibeTvUiKit() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-[1480px] items-center justify-between gap-4 px-5 lg:px-10">
          <div className="flex items-baseline gap-3">
            <div className="text-2xl font-black uppercase tracking-tight">
              VIBE<span className="text-ring">TV</span>
            </div>
            <span className="hidden text-sm font-semibold text-muted-foreground sm:inline">
              Interface system
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Internal preview</Badge>
            <Button size="sm">
              <Check data-icon="inline-start" />
              Ready for review
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1480px] gap-12 px-5 py-10 lg:px-10 lg:py-14">
        <section className="grid gap-8 border-b pb-12 lg:grid-cols-[minmax(0,1.2fr)_minmax(440px,.8fr)] lg:items-end">
          <div>
            <Badge className="mb-5" variant="secondary">VibeTV · shadcn</Badge>
            <h1 className="max-w-4xl text-4xl font-black leading-[1.02] tracking-[-0.04em] sm:text-6xl">
              Sharp signal. Softer system.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              A calmer, consistent interface for Control Center and Theme Studio — with VibeTV&apos;s high-contrast signal color kept at the center.
            </p>
          </div>
          <Card className="bg-foreground text-background">
            <CardHeader>
              <CardTitle className="text-lg">Radius &amp; depth</CardTitle>
              <CardDescription className="text-background/65">
                Rounded enough to feel friendly, still precise enough for a device tool.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-3">
              <RadiusDemo label="Controls" radius="8px" className="rounded-[var(--radius-control)]" />
              <RadiusDemo label="Panels" radius="12px" className="rounded-[var(--radius-card)]" />
              <RadiusDemo label="Badges" radius="6px" className="rounded-[var(--radius-badge)]" />
            </CardContent>
          </Card>
        </section>

        <Section title="Color & type" description="Signal marks actions, Ink carries data, quiet Stroke separates surfaces, and Input keeps controls above 3:1 contrast.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {tokenSwatches.map((token) => (
              <div className="overflow-hidden rounded-[var(--radius-card)] bg-card ring-1 ring-foreground/10" key={token.label}>
                <div className={`h-20 ${token.className}`} />
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 text-xs">
                  <span className="font-bold">{token.label}</span>
                  <span className="font-mono text-muted-foreground">{token.value}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buttons" description="44px touch targets by default, a 2px focus ring, and signal green reserved for the most important next step.">
          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Variants</CardTitle>
                <CardDescription>One primary action per decision area.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-3">
                <Button><Save data-icon="inline-start" />Save theme</Button>
                <Button variant="outline"><Send data-icon="inline-start" />Send to VibeTV</Button>
                <Button variant="secondary"><Download data-icon="inline-start" />Export</Button>
                <Button variant="ghost">Cancel</Button>
                <Button variant="destructive"><Trash2 data-icon="inline-start" />Delete</Button>
                <Button aria-label="More actions" size="icon" variant="outline"><MoreHorizontal /></Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>States</CardTitle>
                <CardDescription>Important states remain recognizable without relying on motion.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StateButton label="Default"><Button className="w-full">Save</Button></StateButton>
                <StateButton label="Hover"><Button className="w-full bg-primary-hover">Save</Button></StateButton>
                <StateButton label="Focus"><Button className="w-full ring-2 ring-ring ring-offset-2">Save</Button></StateButton>
                <StateButton label="Active"><Button className="w-full translate-y-px bg-primary-hover">Save</Button></StateButton>
                <StateButton label="Loading"><Button className="w-full" disabled><LoaderCircle className="animate-spin" data-icon="inline-start" />Saving</Button></StateButton>
                <StateButton label="Disabled"><Button className="w-full" disabled>Save</Button></StateButton>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section title="Cards & status" description="Cards use a subtle 10% ink ring. Shadows appear only when a surface floats above the page.">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle>Theme card</CardTitle>
                <CardDescription>Default information container.</CardDescription>
                <CardAction><Badge variant="secondary">Draft</Badge></CardAction>
              </CardHeader>
              <CardContent>
                <div className="grid aspect-[16/10] place-items-center rounded-[var(--radius-control)] bg-foreground text-background">
                  <span className="text-3xl font-black">08:42</span>
                </div>
              </CardContent>
              <CardFooter className="justify-between">
                <span className="text-xs text-muted-foreground">Edited 2m ago</span>
                <Button size="sm" variant="outline">Open <ChevronRight data-icon="inline-end" /></Button>
              </CardFooter>
            </Card>
            <Card className="ring-2 ring-ring/25">
              <CardHeader>
                <CardTitle>Selected card</CardTitle>
                <CardDescription>Selection is clear but not loud.</CardDescription>
                <CardAction><Badge>Selected</Badge></CardAction>
              </CardHeader>
              <CardContent className="grid min-h-32 place-items-center rounded-[var(--radius-control)] bg-muted">
                <Sparkles className="size-8 text-ring" />
              </CardContent>
              <CardFooter><Button className="w-full">Use this theme</Button></CardFooter>
            </Card>
            <Card>
              <CardHeader><CardTitle>Device</CardTitle><CardDescription>Live status at a glance.</CardDescription></CardHeader>
              <CardContent className="grid gap-3">
                <StatusRow icon={<Wifi />} label="Connected" value="Living room" tone="success" />
                <StatusRow icon={<Check />} label="Theme valid" value="Ready" tone="success" />
                <StatusRow icon={<CloudUpload />} label="Storage" value="64% used" tone="warning" />
              </CardContent>
            </Card>
            <Card className="opacity-55">
              <CardHeader><CardTitle>Disabled card</CardTitle><CardDescription>Unavailable without disappearing.</CardDescription></CardHeader>
              <CardContent className="grid min-h-32 place-items-center rounded-[var(--radius-control)] border border-dashed border-foreground/15 bg-muted/50 text-muted-foreground">
                Device offline
              </CardContent>
              <CardFooter><Button className="w-full" disabled>Send theme</Button></CardFooter>
            </Card>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Badge>Live</Badge>
            <Badge>Ready</Badge>
            <Badge className="bg-warning text-warning-foreground">Needs attention</Badge>
            <Badge variant="destructive">Error</Badge>
            <Badge variant="secondary">Draft</Badge>
            <Badge variant="outline">Offline</Badge>
          </div>
        </Section>

        <Section title="Forms & controls" description="Labels stay visible, help text stays close, and every control uses the same interaction language.">
          <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
            <Card>
              <CardHeader><CardTitle>Theme details</CardTitle><CardDescription>Inputs, selections and editing controls.</CardDescription></CardHeader>
              <CardContent>
                <FieldGroup className="grid gap-5 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="theme-name">Theme name</FieldLabel>
                    <Input defaultValue="Morning dashboard" id="theme-name" />
                    <FieldDescription>Shown in your Theme Library.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="device-select">Target device</FieldLabel>
                    <Select defaultValue="living-room">
                      <SelectTrigger className="h-11 w-full rounded-[var(--radius-control)]" id="device-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="living-room">Living room VibeTV</SelectItem>
                          <SelectItem value="office">Office VibeTV</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>Online devices only.</FieldDescription>
                  </Field>
                  <Field className="md:col-span-2">
                    <FieldLabel htmlFor="theme-note">Description</FieldLabel>
                    <Textarea defaultValue="A calm dashboard for weekday mornings." id="theme-note" />
                  </Field>
                  <Field data-invalid="true">
                    <FieldLabel htmlFor="invalid-name">Validation example</FieldLabel>
                    <Input aria-invalid defaultValue="Untitled / copy" id="invalid-name" />
                    <FieldDescription>Use letters, numbers and spaces only.</FieldDescription>
                  </Field>
                  <Field data-disabled="true">
                    <FieldLabel htmlFor="disabled-field">Device token</FieldLabel>
                    <Input disabled id="disabled-field" placeholder="Available after pairing" />
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Preferences</CardTitle><CardDescription>Selection controls keep generous hit areas.</CardDescription></CardHeader>
              <CardContent className="grid gap-6">
                <div>
                  <div className="mb-3 flex items-center justify-between text-sm"><span className="font-semibold">Brightness</span><span className="text-muted-foreground">72%</span></div>
                  <Slider defaultValue={[72]} max={100} />
                </div>
                <Separator />
                <label className="flex min-h-11 items-start gap-3">
                  <Checkbox className="mt-0.5" defaultChecked />
                  <span><span className="block text-sm font-semibold">Show weather</span><span className="text-sm text-muted-foreground">Use the paired device location.</span></span>
                </label>
                <label className="flex min-h-11 items-start justify-between gap-3">
                  <span><span className="block text-sm font-semibold">Auto update</span><span className="text-sm text-muted-foreground">Install verified theme updates.</span></span>
                  <Switch defaultChecked />
                </label>
                <label className="flex min-h-11 items-start justify-between gap-3 opacity-50">
                  <span><span className="block text-sm font-semibold">Night mode</span><span className="text-sm text-muted-foreground">Not supported by this theme.</span></span>
                  <Switch disabled />
                </label>
              </CardContent>
            </Card>
          </div>
        </Section>

        <Section title="Navigation & overlays" description="The same tab, menu, dialog, popover and sheet patterns scale from desktop to narrow screens.">
          <Tabs defaultValue="layers">
            <TabsList className="h-11 w-full justify-start overflow-x-auto rounded-[var(--radius-control)] p-1 sm:w-fit">
              <TabsTrigger className="min-h-9 px-4" value="layers">Layers</TabsTrigger>
              <TabsTrigger className="min-h-9 px-4" value="assets">Assets</TabsTrigger>
              <TabsTrigger className="min-h-9 px-4" value="validation">Validation <Badge className="ml-1" variant="secondary">2</Badge></TabsTrigger>
            </TabsList>
            <TabsContent className="mt-4" value="layers">
              <Card><CardContent className="flex flex-wrap gap-3 py-1">
                <Dialog>
                  <DialogTrigger asChild><Button variant="outline">Open dialog</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Send theme to VibeTV?</DialogTitle><DialogDescription>The saved theme will replace the current display on Living room VibeTV.</DialogDescription></DialogHeader>
                    <DialogFooter>
                      <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
                      <Button><Send data-icon="inline-start" />Send theme</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Popover>
                  <PopoverTrigger asChild><Button variant="outline">Open popover</Button></PopoverTrigger>
                  <PopoverContent className="w-72"><div className="font-semibold">Device ready</div><p className="mt-1 text-sm text-muted-foreground">Living room VibeTV is online and compatible.</p></PopoverContent>
                </Popover>
                <Sheet>
                  <SheetTrigger asChild><Button variant="outline"><Menu data-icon="inline-start" />Open sheet</Button></SheetTrigger>
                  <SheetContent side="left"><SheetHeader><SheetTitle>Theme Studio</SheetTitle><SheetDescription>Layers and assets remain one tap away on smaller screens.</SheetDescription></SheetHeader></SheetContent>
                </Sheet>
                <Tooltip>
                  <TooltipTrigger asChild><Button aria-label="Preview theme" size="icon" variant="outline"><Play /></Button></TooltipTrigger>
                  <TooltipContent>Preview theme</TooltipContent>
                </Tooltip>
              </CardContent></Card>
            </TabsContent>
            <TabsContent className="mt-4" value="assets"><Card><CardContent>Asset browser preview</CardContent></Card></TabsContent>
            <TabsContent className="mt-4" value="validation"><Card><CardContent>Two fields need attention.</CardContent></Card></TabsContent>
          </Tabs>
        </Section>

        <Section title="Feedback & loading" description="Success, warning and failure are explicit in color, icon and language.">
          <div className="grid gap-4 lg:grid-cols-3">
            <Alert className="border-success-foreground/40 bg-success text-success-foreground">
              <Check /><AlertTitle>Theme saved</AlertTitle><AlertDescription className="text-success-foreground/80">All changes are now in your Theme Library.</AlertDescription>
            </Alert>
            <Alert className="border-warning-foreground/40 bg-warning text-warning-foreground">
              <TriangleAlert /><AlertTitle>Device storage low</AlertTitle><AlertDescription className="text-warning-foreground/80">Remove an unused theme before sending.</AlertDescription>
            </Alert>
            <Alert variant="destructive">
              <AlertCircle /><AlertTitle>Send failed</AlertTitle><AlertDescription>VibeTV went offline. Your theme is still saved.</AlertDescription>
            </Alert>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Transfer progress</CardTitle><CardDescription>Sending Morning dashboard to Living room.</CardDescription></CardHeader>
              <CardContent className="grid gap-3"><Progress value={64} /><div className="flex justify-between text-xs text-muted-foreground"><span>Optimizing assets</span><span>64%</span></div></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Skeleton state</CardTitle><CardDescription>Layout remains stable while content loads.</CardDescription></CardHeader>
              <CardContent className="flex items-center gap-4"><Skeleton className="size-12 rounded-[var(--radius-control)]" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/5" /><Skeleton className="h-3 w-4/5" /></div></CardContent>
            </Card>
          </div>
        </Section>

        <footer className="flex flex-col gap-3 border-t pt-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>VibeTV Interface System · Review build</span>
          <span>10% card rings · 2px focus · restrained elevation</span>
        </footer>
      </div>
    </main>
  );
}

function Section({ children, description, title }: { children: React.ReactNode; description: string; title: string }) {
  return (
    <section>
      <div className="mb-6 max-w-3xl">
        <div className="mb-2 flex items-center gap-3"><span className="size-2 rounded-full bg-primary ring-1 ring-foreground/20" /><h2 className="text-2xl font-black tracking-tight sm:text-3xl">{title}</h2></div>
        <p className="text-base leading-7 text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function RadiusDemo({ className, label, radius }: { className: string; label: string; radius: string }) {
  return <div className={`grid aspect-square place-items-center border border-background/25 bg-background/10 p-2 text-center ${className}`}><div><div className="text-xs text-background/65">{label}</div><div className="mt-1 font-mono text-sm font-bold">{radius}</div></div></div>;
}

function StateButton({ children, label }: { children: React.ReactNode; label: string }) {
  return <div><div className="mb-2 text-xs font-semibold text-muted-foreground">{label}</div>{children}</div>;
}

function StatusRow({ icon, label, tone, value }: { icon: React.ReactNode; label: string; tone: "success" | "warning"; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-control)] p-3 ring-1 ring-foreground/10">
      <div className={`grid size-9 shrink-0 place-items-center rounded-[var(--radius-badge)] ${tone === "success" ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"}`}>{icon}</div>
      <div className="min-w-0"><div className="text-sm font-semibold">{label}</div><div className="truncate text-xs text-muted-foreground">{value}</div></div>
    </div>
  );
}

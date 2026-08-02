import { useState } from "react";
import { useGetTrainStatus, getGetTrainStatusQueryKey } from "@workspace/api-client-react";
import { Button, Input, Badge, Skeleton } from "@/components/ui";
import { Search, MapPin, ArrowLeft, Info, Activity, Clock, Map, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Home() {
  const [trainNo, setTrainNo] = useState("");
  // Default to today
  const [depDate, setDepDate] = useState(() => {
    const d = new Date();
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().split('T')[0];
  });
  const [searched, setSearched] = useState(false);
  const [apiParams, setApiParams] = useState({ train_number: "", departure_date: "" });

  const { data, isLoading, isError, error, isFetching } = useGetTrainStatus(
    apiParams,
    { 
      query: { 
        enabled: searched, 
        queryKey: getGetTrainStatusQueryKey(apiParams),
        retry: false,
        refetchOnWindowFocus: false
      } 
    }
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trainNo.trim() || !depDate) return;
    setApiParams({
      train_number: trainNo.trim(),
      departure_date: depDate.replace(/-/g, "") // '2023-10-15' -> '20231015'
    });
    setSearched(true);
  };

  const reset = () => {
    setSearched(false);
  };

  // Search State
  if (!searched) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center p-4 md:p-6 bg-background relative overflow-hidden">
        {/* Decorative Grid Background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />
        
        <div className="relative z-10 w-full max-w-md">
          <div className="flex flex-col items-center mb-10">
            <div className="w-16 h-16 bg-card border-2 border-primary rounded-full flex items-center justify-center mb-4 shadow-[0_0_15px_rgba(0,255,0,0.15)] relative">
               <Activity className="w-8 h-8 text-primary animate-pulse-fast" />
               <div className="absolute inset-0 rounded-full border border-primary animate-ping opacity-20" />
            </div>
            <h1 className="text-2xl md:text-3xl font-mono font-bold text-foreground tracking-widest text-center uppercase">
              Terminal.Track
            </h1>
            <p className="text-muted-foreground font-mono text-sm mt-2 text-center">
              SYSTEM READY. WAITING FOR DIRECTIVE.
            </p>
          </div>
          
          <form onSubmit={handleSearch} className="bg-card/80 backdrop-blur-sm border border-card-border p-6 md:p-8 rounded-lg shadow-xl space-y-6">
            <div className="space-y-2">
              <label htmlFor="trainNo" className="text-muted-foreground font-mono text-xs uppercase tracking-wider block">
                [01] Train Number
              </label>
              <Input 
                id="trainNo"
                type="text" 
                value={trainNo} 
                onChange={e => setTrainNo(e.target.value)} 
                placeholder="E.G. 22943"
                required
                className="font-mono text-xl h-14 bg-background border-border focus-visible:ring-primary uppercase tracking-widest"
                data-testid="input-train-number"
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="depDate" className="text-muted-foreground font-mono text-xs uppercase tracking-wider block">
                [02] Departure Date
              </label>
              <Input 
                id="depDate"
                type="date" 
                value={depDate} 
                onChange={e => setDepDate(e.target.value)} 
                required
                className="font-mono text-xl h-14 bg-background border-border focus-visible:ring-primary uppercase tracking-widest [color-scheme:dark]"
                data-testid="input-departure-date"
              />
            </div>
            <Button 
              type="submit" 
              className="w-full text-lg h-14 uppercase tracking-widest mt-4 font-bold border border-primary/50 shadow-[0_0_10px_rgba(0,255,0,0.1)] hover:shadow-[0_0_15px_rgba(0,255,0,0.3)] transition-all"
              data-testid="button-submit-search"
            >
              <Search className="w-5 h-5 mr-3" /> Execute Trace
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // Results State
  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Header Band */}
      <header className="bg-card border-b border-border sticky top-0 z-50">
        <div className="max-w-3xl mx-auto px-4 py-4 md:py-6 flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="flex-1">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={reset} 
              className="font-mono text-muted-foreground uppercase text-xs hover:text-foreground hover:bg-transparent -ml-2 mb-2"
              data-testid="button-new-search"
            >
              <ArrowLeft className="w-4 h-4 mr-2" /> Abort & Return
            </Button>
            
            {isLoading || isFetching ? (
              <div className="space-y-3 mt-1">
                <Skeleton className="h-8 w-64 bg-border/50" />
                <Skeleton className="h-4 w-48 bg-border/50" />
              </div>
            ) : data ? (
              <div>
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h1 className="text-2xl md:text-3xl font-mono font-bold text-primary tracking-wider" data-testid="text-train-number">
                    {data.train_number}
                  </h1>
                  <Badge variant="outline" className="text-muted-foreground border-muted-foreground/30 bg-background font-mono text-sm tracking-widest" data-testid="text-train-name">
                    {data.train_name}
                  </Badge>
                </div>
                <div className="text-sm font-mono text-muted-foreground flex items-center gap-2 tracking-wide flex-wrap">
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{data.source_station_name}</span>
                  <span className="text-border">→</span>
                  <span>{data.destination_station_name}</span>
                </div>
              </div>
            ) : null}
          </div>
          
          {data && !isLoading && !isFetching && (
            <div className="flex flex-col md:items-end justify-start shrink-0">
              <Badge 
                variant={data.current_delay_minutes ? "warning" : "success"} 
                className={cn(
                  "text-base py-1.5 px-4 font-mono font-bold tracking-widest border border-current",
                  data.current_delay_minutes ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
                )}
                data-testid="status-delay-badge"
              >
                {data.current_delay_minutes ? `${data.current_delay_minutes}M LATE` : "ON TIME"}
              </Badge>
              {data.last_updated && (
                <div className="text-[10px] text-muted-foreground font-mono mt-2 flex items-center gap-1 uppercase tracking-widest">
                  <Clock className="w-3 h-3" />
                  Updated: {new Date(data.last_updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-3xl w-full mx-auto p-4 md:p-8">
        {(isLoading || isFetching) && (
          <div className="space-y-6">
            <Skeleton className="h-16 w-full bg-border/30" />
            <div className="space-y-0 relative pl-4">
              <div className="absolute top-0 bottom-0 left-[2.4rem] w-px bg-border/30" />
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex gap-4 py-4 relative z-10">
                  <Skeleton className="w-16 h-4 bg-border/30" />
                  <div className="w-3 h-3 rounded-full bg-border/50 shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-48 bg-border/30" />
                    <Skeleton className="h-3 w-32 bg-border/30" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {isError && !isFetching && (
          <div className="bg-destructive/10 border border-destructive rounded-md p-6 flex flex-col items-center text-center space-y-4">
            <AlertTriangle className="w-10 h-10 text-destructive mb-2" />
            <h2 className="font-mono text-lg text-destructive font-bold uppercase tracking-widest">Signal Lost</h2>
            <p className="font-mono text-muted-foreground text-sm max-w-md">
              {(error as any)?.response?.data?.error || "Could not establish connection to the tracking satellite. The train number or date might be invalid, or the train is not scheduled to run today."}
            </p>
            <Button variant="outline" onClick={reset} className="font-mono uppercase tracking-widest mt-2 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground">
              Reconfigure Search
            </Button>
          </div>
        )}

        {data && !isLoading && !isFetching && (
          <div className="space-y-8">
            {/* Status Message */}
            {data.status_message && (
              <div className="bg-primary/5 border border-primary/20 rounded-md p-4 flex items-start gap-3 shadow-[0_0_10px_rgba(0,255,0,0.05)]">
                <Info className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <span className="font-mono text-sm leading-relaxed text-foreground tracking-wide uppercase" data-testid="status-message">
                  {data.status_message}
                </span>
              </div>
            )}

            {/* Timeline */}
            <div className="space-y-0 relative font-mono">
              {data.stations.map((station, index) => {
                const isPassed = station.has_departed;
                const isCurrent = station.is_current;
                const isUpcoming = !isPassed && !isCurrent;
                const isLast = index === data.stations.length - 1;

                const timeSch = station.scheduled_arrival || station.scheduled_departure || "--:--";
                const timeAct = station.actual_arrival || station.actual_departure || null;
                const isDelayed = station.delay_minutes && station.delay_minutes > 0;

                const textColor = isCurrent ? "text-primary" : isPassed ? "text-muted-foreground" : "text-foreground";
                const bgNode = isCurrent 
                  ? "bg-primary shadow-[0_0_12px_rgba(0,255,0,0.8)] animate-pulse-fast border-none" 
                  : isPassed 
                    ? "bg-muted-foreground/30 border-none" 
                    : "bg-background border-2 border-muted-foreground";

                return (
                  <div 
                    key={station.station_code} 
                    className={cn(
                      "flex gap-4 md:gap-6 min-h-[5rem] relative group",
                      isPassed && !isCurrent ? "opacity-60 hover:opacity-100 transition-opacity" : ""
                    )}
                    data-testid={`row-station-${station.station_code}`}
                  >
                    {/* Time Column */}
                    <div className="w-14 md:w-16 shrink-0 text-right pt-0.5 flex flex-col gap-1">
                      <span className={cn("text-xs md:text-sm font-bold leading-none tracking-wider", isPassed ? "text-muted-foreground" : "text-foreground")}>
                        {timeSch}
                      </span>
                      {isDelayed && timeAct && (
                        <span className="text-xs md:text-sm text-warning font-bold leading-none tracking-wider">
                          {timeAct}
                        </span>
                      )}
                    </div>
                    
                    {/* Node & Line Column */}
                    <div className="relative shrink-0 w-4 flex justify-center">
                      {/* Line */}
                      {!isLast && (
                        <div className={cn(
                          "absolute top-3 bottom-[-0.5rem] w-px z-0",
                          isPassed && !isCurrent ? "bg-muted-foreground/30" : "bg-border"
                        )} />
                      )}
                      {/* Node */}
                      <div className={cn("w-3 h-3 rounded-full z-10 relative mt-1 shrink-0", bgNode)} />
                    </div>
                    
                    {/* Details Column */}
                    <div className="flex-1 pb-8 group-last:pb-2">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-4">
                        <div>
                          <div className={cn("text-sm md:text-base font-bold uppercase tracking-wider flex items-center gap-2", textColor)}>
                            {station.station_name} 
                            <span className="opacity-50 font-normal text-xs md:text-sm">[{station.station_code}]</span>
                          </div>
                          <div className="text-[10px] md:text-xs text-muted-foreground mt-2 flex gap-x-4 gap-y-1 flex-wrap uppercase tracking-widest font-semibold">
                            <span className="flex items-center gap-1">
                              <Map className="w-3 h-3" /> PF {station.platform || "-"}
                            </span>
                            <span>{station.distance_from_source}KM</span>
                            <span>HALT: {station.halt_minutes ? `${station.halt_minutes}M` : "-"}</span>
                            <span>DAY {station.day}</span>
                          </div>
                        </div>
                        
                        {station.delay_minutes && station.delay_minutes > 0 ? (
                          <Badge variant="outline" className="text-[10px] h-5 py-0 border-warning text-warning shrink-0 mt-1 sm:mt-0 tracking-widest bg-warning/5">
                            {station.delay_minutes}M LATE
                          </Badge>
                        ) : station.delay_minutes === 0 && !isUpcoming ? (
                           <Badge variant="outline" className="text-[10px] h-5 py-0 border-success text-success shrink-0 mt-1 sm:mt-0 tracking-widest bg-success/5">
                             ON TIME
                           </Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// Erlang C call-center staffing model.
//
// Industry-standard math for "given expected calls/hour with a known
// average handle time, how many agents do I need to hit a target service
// level?" Outputs minimum agents, occupancy %, expected wait time, and
// probability a caller waits at all.
//
// Inputs:
//   λ (lambda)  arrival rate, calls per hour
//   AHT         average handle time, seconds (talk + wrap)
//   sla_target  fraction of calls answered within sla_seconds (e.g. 0.8)
//   sla_seconds the wait time threshold (e.g. 20s)
//   shrinkage   fraction of paid time that's NOT available for calls
//               (breaks, training, meetings; typical 0.25-0.35)
//
// Returns:
//   {
//     traffic: λ * AHT/3600 (Erlangs — agent-hours per hour of demand)
//     min_agents: smallest N such that achieved SLA >= sla_target
//     min_agents_with_shrinkage: ceil(min_agents / (1 - shrinkage))
//     occupancy: traffic / min_agents (fraction of agent time on calls)
//     prob_wait: probability a call has to wait (Erlang C formula)
//     avg_wait_seconds: ASA (average speed of answer)
//     achieved_sla: fraction answered within sla_seconds at min_agents
//   }
//
// References:
// - https://en.wikipedia.org/wiki/Erlang_(unit)#Erlang_C_formula
// - https://www.callcentrehelper.com/erlang-c-formula-explained-119033.htm

export interface ErlangCInput {
  callsPerHour: number;
  ahtSeconds: number;
  slaTarget: number;        // 0..1 (e.g. 0.8 for 80%)
  slaSeconds: number;       // e.g. 20
  shrinkage: number;        // 0..1 (e.g. 0.3 for 30%)
  maxAgents?: number;       // safety cap, default 200
}

export interface ErlangCResult {
  traffic: number;                  // Erlangs
  minAgents: number;                // raw (productive seats)
  minAgentsWithShrinkage: number;   // scheduled headcount
  occupancy: number;                // 0..1
  probWait: number;                 // 0..1
  avgWaitSeconds: number;
  achievedSla: number;              // 0..1
  feasible: boolean;                // false if no N up to maxAgents hits SLA
}

// Erlang C: probability a call must wait, given N agents and traffic A.
// Uses a numerically stable iterative formulation that avoids factorials.
function erlangC(agents: number, traffic: number): number {
  if (agents <= 0) return 1;
  if (traffic <= 0) return 0;
  if (traffic >= agents) return 1;       // unstable (offered load >= capacity)

  // P(0 agents busy) recurrence: term_k = traffic^k / k!
  // Sum = Σ_{k=0..N-1} term_k + term_N * N / (N - traffic)
  let term = 1;            // k = 0: traffic^0 / 0! = 1
  let sum = 1;
  for (let k = 1; k < agents; k++) {
    term = term * traffic / k;
    sum += term;
  }
  // term is now traffic^(N-1) / (N-1)!
  const termN = term * traffic / agents;
  const tail = termN * agents / (agents - traffic);
  const denom = sum + tail;
  return tail / denom;
}

// Service-level achieved at N agents: fraction answered within slaSeconds.
function achievedServiceLevel(agents: number, traffic: number, ahtSeconds: number, slaSeconds: number): number {
  if (agents <= 0 || traffic >= agents) return 0;
  const pw = erlangC(agents, traffic);
  // P(wait > t) = pw * exp(-(N - traffic) * t / AHT)
  const exponent = -(agents - traffic) * (slaSeconds / ahtSeconds);
  const probWaitMoreThanT = pw * Math.exp(exponent);
  return 1 - probWaitMoreThanT;
}

export function erlangCStaff(input: ErlangCInput): ErlangCResult {
  const { callsPerHour, ahtSeconds, slaTarget, slaSeconds, shrinkage, maxAgents = 200 } = input;
  const traffic = callsPerHour * (ahtSeconds / 3600);    // Erlangs
  if (callsPerHour <= 0) {
    return {
      traffic: 0, minAgents: 0, minAgentsWithShrinkage: 0,
      occupancy: 0, probWait: 0, avgWaitSeconds: 0, achievedSla: 1, feasible: true,
    };
  }
  // Start at ceil(traffic) + 1 — anything less is unstable.
  const start = Math.max(1, Math.ceil(traffic) + 1);
  let chosen = -1;
  let chosenSla = 0;
  for (let n = start; n <= maxAgents; n++) {
    const sla = achievedServiceLevel(n, traffic, ahtSeconds, slaSeconds);
    if (sla >= slaTarget) {
      chosen = n;
      chosenSla = sla;
      break;
    }
  }
  if (chosen === -1) {
    // Fallback to the cap with whatever SLA it gets.
    chosen = maxAgents;
    chosenSla = achievedServiceLevel(maxAgents, traffic, ahtSeconds, slaSeconds);
    return {
      traffic, minAgents: maxAgents, minAgentsWithShrinkage: Math.ceil(maxAgents / Math.max(0.01, 1 - shrinkage)),
      occupancy: traffic / maxAgents,
      probWait: erlangC(maxAgents, traffic),
      avgWaitSeconds: averageSpeedOfAnswer(maxAgents, traffic, ahtSeconds),
      achievedSla: chosenSla,
      feasible: false,
    };
  }
  const occupancy = traffic / chosen;
  const probWait = erlangC(chosen, traffic);
  const avgWait = averageSpeedOfAnswer(chosen, traffic, ahtSeconds);
  const minAgentsWithShrinkage = Math.ceil(chosen / Math.max(0.01, 1 - shrinkage));
  return {
    traffic,
    minAgents: chosen,
    minAgentsWithShrinkage,
    occupancy,
    probWait,
    avgWaitSeconds: avgWait,
    achievedSla: chosenSla,
    feasible: true,
  };
}

function averageSpeedOfAnswer(agents: number, traffic: number, ahtSeconds: number): number {
  if (agents <= traffic) return Infinity;
  const pw = erlangC(agents, traffic);
  return (pw * ahtSeconds) / (agents - traffic);
}

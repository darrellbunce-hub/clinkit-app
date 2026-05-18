# Keynetic — Product & Architecture Foundation

## Vision

Keynetic is a shared transaction coordination platform designed to make residential property moving clearer, more transparent, and less stressful.

The platform is built around the idea that a property chain is not a collection of isolated transactions, but a connected operational network where progress, delays, and communication in one transaction affect everyone else.

Keynetic aims to reduce uncertainty by providing structured progress visibility, chain coordination, and operational transparency without exposing sensitive participant information.

---

# What Keynetic Is

Keynetic is:

* A multi-party property chain coordination platform
* A structured workflow and progress tracking system
* A transparency and confidence layer for property transactions
* A shared operational timeline for chain participants
* A future coordination layer between homeowners and professionals

Keynetic is NOT:

* A conveyancing replacement
* An estate agency CRM
* A legal document platform
* A mortgage platform
* A marketplace for listings

The platform complements existing industry systems rather than replacing them.

---

# Core Product Principles

## 1. Reduce Uncertainty

The primary value of Keynetic is reducing uncertainty during the moving process.

Users should feel:

* informed
* reassured
* connected to progress
* aware of blockers
* less emotionally stressed

The platform should avoid creating unnecessary anxiety.

---

## 2. Chains Are Networks

A property chain is a connected dependency network.

Progress in one property affects:

* downstream transactions
* upstream transactions
* completion likelihood
* overall confidence

Keynetic models chains as connected operational systems rather than isolated property sales.

---

## 3. Structured Operational State

Operational progress must use structured workflow stages rather than free-text statuses.

This enables:

* forecasting
* confidence scoring
* bottleneck detection
* analytics
* automation
* timeline consistency

The structured workflow engine is authoritative.

Activity feeds should primarily be generated from structured workflow changes.

---

## 4. Privacy First

Homeowner-facing chain views must never expose identifiable property information for other chain participants.

Homeowners must NOT see:

* full addresses
* postcodes
* broad locations
* identifiable property references
* names of unrelated chain participants

Homeowner chain views should display generic labels only:

* Property 1
* Property 2
* Property 3

This is a core platform rule.

---

## 5. Role-Based Visibility

Visibility is role-scoped.

Different users may eventually receive different visibility layers.

Examples:

### Homeowners

* Generic property labels only
* Shared chain progress visibility
* No identifiable chain participant information

### Estate Agents

* May later see limited address visibility for their own clients only
* May later receive operational dashboards

### Solicitors

* May later receive workflow-specific visibility
* May later receive legal milestone coordination views

Public and internal visibility must remain separated.

---

## 6. New Chains Should Feel Optimistic

The platform should avoid alarming users unnecessarily.

New chains should default to:

* optimistic
* collaborative
* supportive

Bottleneck detection should require:

* sufficient chain age
* meaningful delay indicators
* materially lagging progress
* stale operational updates

Newly created chains should not immediately display bottleneck warnings.

---

# Current Platform Architecture

## Frontend

* Next.js
* React
* TypeScript
* Tailwind CSS

## Backend

* Supabase
* PostgreSQL
* Supabase Auth
* Supabase Realtime (future planned expansion)

## Hosting

* Vercel

---

# Environment Architecture

## Production

Branch:

* main

Connected to:

* Production Vercel deployment
* Production Supabase branch/project

---

## Staging / Preview

Branch:

* staging-test

Connected to:

* Vercel Preview deployments
* Development Supabase branch/project

This allows:

* safe experimentation
* mobile testing
* demo environments
* feature testing without production risk

---

# Authentication Architecture

Current implementation:

* Supabase authentication
* Session persistence
* Client-side route handling

Middleware protection is currently simplified during development due to SSR session timing behaviour.

Future implementation:

* full Supabase SSR middleware refresh handling

---

# Current Core Systems

## Chain System

Chains are represented as connected transaction groups.

Properties are linked by:

* chainId
* chainPosition

Properties may later evolve into a participant-driven transaction architecture.

---

## Property System

Properties currently contain:

* transaction stage
* progress percentage
* activity history
* chain relationships
* update timestamps

Future direction:

* multi-participant support
* transaction-node architecture
* participant relationship modelling

---

## Structured Workflow Engine

Workflow stages are defined centrally in:

* data/stages.ts

Stages include:

* value
* label
* progress percentage
* expected timeframe
* next step

This workflow engine is the authoritative operational state model.

---

## Activity Feed System

The activity feed provides chronological operational visibility.

Current behaviour:

* activities are tied to properties
* activities render across the full chain timeline
* homeowner views hide identifiable property information

Future direction:

* activities automatically generated from stage transitions
* structured operational events
* realtime updates
* notifications
* comments/notes layer

---

## Confidence & Chain Intelligence

The platform already contains early intelligence systems including:

* chain confidence scoring
* bottleneck detection
* stale update logic
* forecast modelling

Future improvements:

* smarter delay detection
* operational risk scoring
* confidence forecasting
* timeline prediction
* probability modelling

---

# Current UX Philosophy

Keynetic should feel:

* calm
* modern
* transparent
* trustworthy
* emotionally reassuring

The platform should NOT feel:

* intrusive
* alarming
* overly corporate
* surveillance-oriented

The goal is collaborative transparency without participant exposure.

---

# Why Keynetic Exists

The UK property transaction process is fragmented.

Current participants:

* buyers
* sellers
* estate agents
* solicitors
* brokers

typically operate in disconnected systems.

No participant currently owns the shared chain experience.

This creates:

* uncertainty
* communication delays
* emotional stress
* lack of transparency
* fragmented progress visibility

Keynetic exists to become the shared coordination layer between these fragmented workflows.

---

# Why Similar Products Have Not Fully Solved This

The difficulty is not purely technical.

The core challenge is:

* fragmented incentives
* disconnected workflows
* cross-organisational coordination
* inconsistent data ownership
* adoption friction

Most existing systems solve only one silo:

* estate agency CRM
* conveyancing portal
* mortgage workflow
* personal moving checklist

Keynetic’s differentiation is treating the chain itself as the primary operational entity.

---

# Long-Term Strategic Direction

Potential future capabilities:

* professional dashboards
* chain-wide notifications
* realtime operational coordination
* predictive completion forecasting
* automated risk detection
* chain break workflows
* participant invitation flows
* professional integrations
* workflow automation
* chain health analytics

The long-term direction is a shared transaction coordination platform rather than a simple progress tracker.

---

# Current Development Priorities

## Immediate

* architecture consistency
* privacy enforcement
* structured activity generation
* stable chain workflows
* bottleneck logic refinement
* mobile UX improvements

## Medium-Term

* realtime updates
* participant role layers
* notification systems
* improved chain intelligence
* onboarding optimisation

## Long-Term

* ecosystem integrations
* professional tooling
* workflow automation
* predictive transaction intelligence

---

# Architectural Guardrails

These rules should not be violated without deliberate review.

## Privacy

* No homeowner-facing identifiable chain property data
* No unrelated participant identity exposure

## Workflow

* Structured workflow stages remain authoritative
* Operational state should not devolve into uncontrolled free text

## UX

* Avoid alarming users unnecessarily
* New chains should default optimistic
* Confidence should feel supportive rather than punitive

## Platform Direction

* Keynetic coordinates workflows
* Keynetic does not attempt to replace solicitors or estate agents
* Keynetic acts as a shared transparency and coordination layer

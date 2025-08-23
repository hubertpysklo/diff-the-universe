# diff-the-universe

┌─────────────────┐
│ User Request    │ → "AI startup in SF with 5 employees"
└────────┬────────┘
         │
    ┌────▼─────────────┐
    │ Orchestrator     │ → Analyzes schema, creates personas
    │ Agent            │   and simulation parameters
    └────────┬─────────┘
             │
    ┌────────▼─────────┐
    │ Persona Factory  │ → Generates N distinct personalities
    │                  │   with roles, traits, schedules
    └────────┬─────────┘
             │
    ┌────────▼─────────┐
    │ Simulation       │ → Multi-agent conversation loop
    │ Engine           │   with probabilistic turn-taking
    └────────┬─────────┘
             │
    ┌────────▼─────────┐
    │ Data Transformer │ → Converts conversations to
    │                  │   service-specific formats
    └────────┬─────────┘
             │
    ┌────────▼─────────┐
    │ DB Populator    │ → Writes to actual DB tables
    └──────────────────┘

## Configuration

Create a `.env` file in the project root with the following variables:

```bash
# Database Configuration
DATABASE_URL=postgresql://user:password@host:port/database

# Neon API Configuration (for MCP testing)
NEON_API_KEY=your_neon_api_key_here
NEON_PROJECT_ID=your_neon_project_id_here
NEON_DATABASE=your_database_name_here

# Table Filtering Configuration

## SERVICE_FILTERS - Exclude tables by service name
# Filters OUT tables containing the specified patterns
# Supports multiple patterns separated by commas
# Examples:
#   SERVICE_FILTERS=gmail                # Exclude all gmail_* tables
#   SERVICE_FILTERS=gmail,slack          # Exclude gmail_* and slack_* tables
#   SERVICE_FILTERS=test_*,tmp_*         # Exclude test and temp tables
SERVICE_FILTERS=

## TABLE_FILTER_PATTERN - Include only specific tables
# Filters IN tables matching the specified patterns
# Supports wildcards (*) and multiple patterns separated by commas
# Examples:
#   TABLE_FILTER_PATTERN=users_*         # Include only tables starting with "users_"
#   TABLE_FILTER_PATTERN=*_service       # Include only tables ending with "_service"
#   TABLE_FILTER_PATTERN=auth_*,user_*   # Include tables starting with "auth_" OR "user_"
TABLE_FILTER_PATTERN=
```

### Filter Priority

When both filters are specified:
1. **Exclusion filter (`SERVICE_FILTERS`)** is applied first to remove unwanted tables
2. **Inclusion filter (`TABLE_FILTER_PATTERN`)** is then applied to the remaining tables

### Usage Examples

```bash
# Exclude gmail tables from the simulation
export SERVICE_FILTERS="gmail"
npm run orchestrator:test

# Include only core messaging tables
export TABLE_FILTER_PATTERN="users,channels,members,chat"
npm run orchestrator:test

# Exclude gmail and include only messaging tables
export SERVICE_FILTERS="gmail"
export TABLE_FILTER_PATTERN="users,channels,members,chat"
npm run orchestrator:test
```


    
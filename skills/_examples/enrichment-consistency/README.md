# enrichment-consistency

This is a paperlab skill — a self-contained "extension package" that
adds cross-tool GSEA concordance to the paperlab agent.

## Structure

```
enrichment-consistency/
├── SKILL.md            # Agent-Skills compatible frontmatter + body
├── manifest.yaml       # paperlab-specific schema
├── scripts/
│   └── run.py          # entry_point
└── tests/              # optional smoke + oracle tests
```

## Install

```sh
# From a local path (offline):
paperlab skill install kral/enrichment-consistency@0.1.0 --from /path/to/this/dir

# From the registry (when published):
paperlab skill install kral/enrichment-consistency@0.1.0
```

## Publish

```sh
# 1. Push to a public git repo
git remote add origin git@github.com:your-name/paperlab-skill-enrichment-consistency
git push -u origin main
git tag v0.1.0 && git push --tags

# 2. Add to the registry (paper-skills-registry repo):
#    kral/enrichment-consistency:
#      url: https://github.com/your-name/paperlab-skill-enrichment-consistency
#      versions: [v0.1.0]
```

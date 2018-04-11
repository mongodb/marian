# Marian

Marian is an HTTP full text search service.

## Running Marian

### Prerequisites

You will need Node.js v8.0 or later.

###

### Launching the Marian Server

```
npm install
node ./src/index.js [MANIFEST_SOURCE]
```

Marian will then read the manifest directory given in `MANIFEST_SOURCE`, and
begin listening to requests on port 8000.

### Manifest Source

Marian requires a manifest source directory. This may either be a local
path, or an Amazon S3 path. For example, `dir:./manifests/` or
`bucket:docs-mongodb-org-prod/search-indexes/`.

The path must contain only JSON files having the following JSON schema:

```
{
  "$id": "http://example.com/example.json",
  "type": "object",
  "definitions": {},
  "$schema": "http://json-schema.org/draft-07/schema#",
  "properties": {
    "url": {
      "$id": "/properties/url",
      "type": "string",
      "title": "The Url Schema ",
      "default": ""
    },
    "includeInGlobalSearch": {
      "$id": "/properties/includeInGlobalSearch",
      "type": "boolean",
      "title": "The Includeinglobalsearch Schema ",
      "default": false
    },
    "aliases": {
      "$id": "/properties/aliases",
      "type": "array"
    },
    "documents": {
      "$id": "/properties/documents",
      "type": "array",
      "items": {
        "$id": "/properties/documents/items",
        "type": "object",
        "properties": {
          "slug": {
            "$id": "/properties/documents/items/properties/slug",
            "type": "string",
            "title": "The Slug Schema ",
            "default": ""
          },
          "title": {
            "$id": "/properties/documents/items/properties/title",
            "type": "string",
            "title": "The Title Schema ",
            "default": ""
          },
          "headings": {
            "$id": "/properties/documents/items/properties/headings",
            "type": "array",
            "items": {
              "$id": "/properties/documents/items/properties/headings/items",
              "type": "string",
              "title": "The 0th Schema ",
              "default": ""
            }
          },
          "text": {
            "$id": "/properties/documents/items/properties/text",
            "type": "string",
            "title": "The Text Schema ",
            "default": ""
          },
          "preview": {
            "$id": "/properties/documents/items/properties/preview",
            "type": "string",
            "title": "The Preview Schema ",
            "default": "",
          },
          "tags": {
            "$id": "/properties/documents/items/properties/tags",
            "type": "string",
            "title": "The Tags Schema ",
            "default": ""
          },
          "links": {
            "$id": "/properties/documents/items/properties/links",
            "type": "array",
            "items": {
              "$id": "/properties/documents/items/properties/links/items",
              "type": "string",
              "title": "The 0th Schema ",
              "default": ""
            }
          }
        }
      }
    }
  }
}
```

## Marian REST API

```

GET /search?q=<query>[&searchProperty=<searchProperty>]
  Returns search results. For example, see https://marian.mongodb.com/search?q=aggregation%20pipeline
GET /status
  Returns a status document
POST /refresh
  When this endpoint is POSTed, Marian will rescan the manifest source
  directory.

```

## FileMaker SaveAsXML

Das **Save a Copy as XML** (oft kurz _SaveAsXML_ genannt) ist eine Funktion in Claris FileMaker zum Exportieren einer offenen FileMaker-Datei in Form einer XML-Datei. Dieses XML enthält sämtliche Schema- und Strukturdetails der FileMaker-Lösung – Tabellen, Felddefinitionen, Layouts, Skripte, Wertelisten, Sicherheitsberechtigungen usw. – jedoch keine Daten aus den Tabellen . Die XML-Datei dient somit der Dokumentation der Anwendung und ermöglicht es Entwicklern, Änderungen im Aufbau der FileMaker-Datei nachzuvollziehen.


## XML-Struktur

Hier ist die High-Level-Struktur des XML Exports aus der FileMaker Datei.

```XML
<?xml version="1.0" encoding="utf-8"?>
<FMSaveAsXML version="2.2.0.0" Source="19.6.3" File="Dateiname.fmp12" UUID="3577981F-2DDF-45FC-9720-9570570760DB" locale="German">
    <Structure membercount="1">
        <AddAction membercount="18">
            <BaseDirectoryCatalog membercount="1" generate="True" temporary="True">...</BaseDirectoryCatalog>
            <ExternalDataSourceCatalog membercount="4">...</ExternalDataSourceCatalog>
            <BaseTableCatalog membercount="5">...</BaseTableCatalog>
            <TableOccurrenceCatalog membercount="7">...</TableOccurrenceCatalog>
            <CustomFunctionsCatalog membercount="28">...</CustomFunctionsCatalog>
            <FieldsForTables membercount="5">...</FieldsForTables>
            <ValueListCatalog membercount="1">...</ValueListCatalog>
            <RelationshipCatalog membercount="3">...</RelationshipCatalog>
            <CalcsForCustomFunctions membercount="28">...</CalcsForCustomFunctions>
            <ScriptCatalog membercount="106">...</ScriptCatalog>
            <ThemeCatalog membercount="1">...</ThemeCatalog>
            <LayoutCatalog membercount="7">...</LayoutCatalog>
            <PrivilegeSetsCatalog membercount="6">...</PrivilegeSetsCatalog>
            <ExtendedPrivilegesCatalog membercount="9">...</ExtendedPrivilegesCatalog>
            <AccountsCatalog membercount="6">...</AccountsCatalog>
            <StepsForScripts membercount="82">...</StepsForScripts>
            <CustomMenuCatalog membercount="24">...</CustomMenuCatalog>
            <PasteIndexList membercount="0"></PasteIndexList>
        </AddAction>
    </Structure>
```

## AutoEnter-Knoten (innerhalb von Field-Elementen)

Jedes `<Field>`-Element in `FieldsForTables` kann ein `<AutoEnter>`-Kind enthalten:

```xml
<AutoEnter type="<TYPE>" prohibitModification="True|False">
    <!-- typ-spezifische Kinder -->
</AutoEnter>
```

### AutoEnter-Typen

| Typ | Kinder |
|-----|--------|
| `SerialNumber` | `<SerialNumber increment="1" nextvalue="207782" generate="OnCreation"/>` |
| `Looked_up` | `<Looked_up>` mit FieldReference (siehe unten) |
| `Calculated` | `<Calculated>` mit Calculation/Text (Formel) und DDRREF (Hash) |
| `ConstantData` | `<ConstantData>Wert</ConstantData>` |
| `CreationDate`, `CreationTime`, `CreationTimestamp`, `CreationName`, `CreationAccountName` | keine |
| `ModificationDate`, `ModificationTime`, `ModificationTimestamp`, `ModificationName`, `ModificationAccountName` | keine |

### Lookup-Struktur (Looked_up)

```xml
<AutoEnter type="Looked_up" prohibitModification="False">
    <Looked_up dontCopyIfEmpty="False" noMatchCopyOption="DoNotCopy">
        <FieldReference id="12" name="Vorgabe 9" UUID="3082C86A-...">
            <TableOccurrenceReference id="1065097" name="Artikel Sortiment" UUID="11A6B529-..."/>
        </FieldReference>
        <Context>
            <TableOccurrenceReference id="1065089" name="Artikel" UUID="73ECAA67-..."/>
        </Context>
    </Looked_up>
</AutoEnter>
```

### AutoEnter Calculated-Struktur

```xml
<AutoEnter type="Calculated" prohibitModification="False" overwriteExisting="True" alwaysEvaluate="False">
    <Calculated>
        <Calculation>
            <TableOccurrenceReference id="1065089" name="Bestaende" UUID="0DD01566-..."/>
            <DDRREF kind="ChunkList" hash="5754CB6D...">...</DDRREF>
            <Text><![CDATA[Regale::Index]]></Text>
        </Calculation>
    </Calculated>
</AutoEnter>
```

### ConstantData-Struktur

```xml
<AutoEnter type="ConstantData" prohibitModification="False">
    <ConstantData>1</ConstantData>
</AutoEnter>


```xml
    <Metadata membercount="1">
        <AddAction membercount="6">
            <Encryption type="0"></Encryption>
            <Minimum version="16.0" value="1600"></Minimum>
            <Login type="1">...</Login>
            <Defaults>...</Defaults>
            <Spelling underline="False"></Spelling>
            <ScriptTriggers membercount="1">...</ScriptTriggers>
        </AddAction>
    </Metadata>
</FMSaveAsXML>
```

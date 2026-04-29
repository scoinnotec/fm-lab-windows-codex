## FileMaker SaveAsXML

Das **Save a Copy as XML** (oft kurz _SaveAsXML_ genannt) ist eine Funktion in Claris FileMaker zum Exportieren einer offenen FileMaker-Datei in Form einer XML-Datei. Dieses XML enthält sämtliche Schema- und Strukturdetails der FileMaker-Lösung – Tabellen, Felddefinitionen, Layouts, Skripte, Wertelisten, Sicherheitsberechtigungen usw. – jedoch keine Daten aus den Tabellen . Die XML-Datei dient somit der Dokumentation der Anwendung und ermöglicht es Entwicklern, Änderungen im Aufbau der FileMaker-Datei nachzuvollziehen.

Wenn man die Option "Include details for analysis tools" auswählt, werden zusätzliche Informationen in das XML Schema aufgenommen. 


## XML-Struktur erweitert

Hier ist die High-Level-Struktur des XML Exports aus der FileMaker Datei.
Wesentlicher Unterschied ist der Katalog `<DDR_INFO>` welcher Informationen zu Formeln als Chunk-Liste und zu Script-Schritten im Klartext enthält.

Um festzustellen, ob die erweiterten Einträge vorhanden sind, ist das Attribut `Has_DDR_INFO="True"` im Root-Element `<FMSaveAsXML>` gesetzt.


```XML
<?xml version="1.0" encoding="utf-8"?>
<FMSaveAsXML version="2.2.3.0" Source="22.0.4" File="Preise.fmp12" UUID="0ED9DE59-5F50-4AC7-9559-523C13442ED5" locale="English" Has_DDR_INFO="True">
    <Structure membercount="2">
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
        <ModifyAction membercount="2">
            <FieldsForTables membercount="42">...</FieldsForTables>
            <LayoutCatalog membercount="1">...</LayoutCatalog>
        </ModifyAction>
    </Structure>
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
	<DDR_INFO>
		<Calculation>
			<ObjectList>
				<_7AF3C07C-BDD6-4710-B81C-0FDBEF81858A_0 hash="027637D0F9A46FCD9BFCA8738C3FA47B" datatype="ChunkList">
					<TableOccurrenceReference id="1065089" name="Preise" UUID="7ED28AAE-2DA6-4357-B4F5-4821D4FE96F0"></TableOccurrenceReference>
					<ChunkList hash="027637D0F9A46FCD9BFCA8738C3FA47B">
						<Chunk type="FunctionRef">If</Chunk>
						<Chunk type="NoRef">( </Chunk>
						<Chunk type="FunctionRef">not</Chunk>
						<Chunk type="NoRef"> </Chunk>
						<Chunk type="FunctionRef">IsEmpty</Chunk>
						<Chunk type="NoRef">(</Chunk>
						<Chunk type="FieldRef">
							<FieldReference id="5" name="Lieferanten Nr" repetition="1" UUID="D550B213-FC57-4F53-A112-22259B0870B5">
								<TableOccurrenceReference id="1065089" name="Preise" UUID="7ED28AAE-2DA6-4357-B4F5-4821D4FE96F0"></TableOccurrenceReference>
							</FieldReference>
						</Chunk>
						<Chunk type="NoRef">);</Chunk>
						<Chunk type="FieldRef">
							<FieldReference id="2" name="Artikel Nr" repetition="1" UUID="D19C9476-B58D-405E-B8C7-876BB2684EB5">
								<TableOccurrenceReference id="1065089" name="Preise" UUID="7ED28AAE-2DA6-4357-B4F5-4821D4FE96F0"></TableOccurrenceReference>
							</FieldReference>
						</Chunk>
						<Chunk type="NoRef">;&quot;&quot;)</Chunk>
					</ChunkList>
				</_7AF3C07C-BDD6-4710-B81C-0FDBEF81858A_0>
                ...
            </ObjectList>
		</Calculation>
		<Script>
			<ObjectList>
				<_6A6C19D0-77D3-4E00-A18A-5A0DE39A59D6 hash="0A981E7C3F8DB44B097FDEF591767932" datatype="StepText">Perform Script [ “Ablage: Schliessen” ]</_6A6C19D0-77D3-4E00-A18A-5A0DE39A59D6>
				<_2F1D9460-94F9-45B6-A96B-43E06ABC1CAB hash="0FA1049AA7A69EEAB05D9C107CE4CFE5" datatype="StepText">Perform Script [ “Module: Übersicht” from file: “Hauptmenu” ]</_2F1D9460-94F9-45B6-A96B-43E06ABC1CAB>
                ...
            </ObjectList>
		</Script>
	</DDR_INFO>
</FMSaveAsXML>
```

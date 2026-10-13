-- OWNER-approved IDs, rechecked from existing Wix identities and Good Life Drive.
-- New sources stay PENDING until authenticated Apps Script verifies live membership.
INSERT INTO headshot_photo_sources(folder_id,display_label) VALUES
 ('1gqUTlsMw2Q8Po6YtoivsvC9rEuI16Iio','Janie'),
 ('1WM7epm1HUkb97dOkC4CaLyCyZ95kENB0','Both'),
 ('1Nhu67c2KYspt14jbK67VzPC8jVD4Waa5','Both')
ON CONFLICT(folder_id) DO NOTHING;
INSERT INTO headshot_leader_sources(wix_item_id,folder_id,relationship_type,sort_order) VALUES
 ('02a9ab6c-42a6-4568-8b14-f46e0ca08dc2','1gqUTlsMw2Q8Po6YtoivsvC9rEuI16Iio','INDIVIDUAL',0),
 ('02a9ab6c-42a6-4568-8b14-f46e0ca08dc2','1WM7epm1HUkb97dOkC4CaLyCyZ95kENB0','SHARED',1),
 ('e42172c5-67dc-4971-a87c-a507551e1ad3','1WM7epm1HUkb97dOkC4CaLyCyZ95kENB0','SHARED',1),
 ('44e7c572-ea70-4b9d-a0ed-6efd86b7b97f','1Nhu67c2KYspt14jbK67VzPC8jVD4Waa5','SHARED',1),
 ('ccacc448-5bfc-4697-8471-3ee9794fca4c','1Nhu67c2KYspt14jbK67VzPC8jVD4Waa5','SHARED',1)
ON CONFLICT(wix_item_id,folder_id) DO NOTHING;
UPDATE headshot_photo_sources SET display_label='Raymond' WHERE folder_id='1LFFE7bRCnRpyOBApVISQfxggjf83miQm';
